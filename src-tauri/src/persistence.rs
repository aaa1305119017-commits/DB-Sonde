//! Filesystem boundary shared by local repositories; no UI or database dependencies.
use crate::error::AppResult;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

/// Serialize before touching disk, flush a unique sibling, then atomically replace.
/// Readers see the old or new complete document. Failed writes leave the old file intact.
pub fn write_json_atomic<T: Serialize + ?Sized>(path: &Path, value: &T) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> AppResult<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaces_complete_json_and_preserves_old_file_on_failure() {
        let dir =
            std::env::temp_dir().join(format!("sonde-persistence-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("records.json");
        write_json_atomic(&path, &vec![1, 2]).unwrap();
        write_json_atomic(&path, &vec![3]).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "[\n  3\n]");
        let invalid_path = dir.join("missing").join("records.json");
        assert!(write_json_atomic(&invalid_path, &vec![4]).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "[\n  3\n]");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
