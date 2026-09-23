use crate::error::{AppError, AppResult};
use crate::models::DbKind;

fn ident(kind: DbKind, name: &str) -> AppResult<String> {
    if name.is_empty() || name.contains('\0') {
        return Err(AppError::msg("对象名称不能为空或包含空字符"));
    }
    let quote = if matches!(kind, DbKind::Mysql | DbKind::Mariadb | DbKind::Clickhouse) {
        '`'
    } else {
        '"'
    };
    Ok(format!(
        "{quote}{}{quote}",
        name.replace(quote, &format!("{quote}{quote}"))
    ))
}

pub fn statement(
    kind: DbKind,
    object_kind: &str,
    database: &str,
    schema: &str,
    table: &str,
) -> AppResult<String> {
    let system = match kind {
        DbKind::Mysql | DbKind::Mariadb => {
            ["mysql", "sys", "information_schema", "performance_schema"]
                .contains(&database.to_ascii_lowercase().as_str())
        }
        DbKind::Postgres => {
            ["template0", "template1"].contains(&database.to_ascii_lowercase().as_str())
                || schema.to_ascii_lowercase().starts_with("pg_")
                || schema.eq_ignore_ascii_case("information_schema")
        }
        DbKind::Clickhouse => {
            database.eq_ignore_ascii_case("system")
                || database.eq_ignore_ascii_case("information_schema")
        }
        DbKind::Sqlite => table.to_ascii_lowercase().starts_with("sqlite_"),
        DbKind::Oracle => ["SYS", "SYSTEM"].contains(&schema.to_ascii_uppercase().as_str()),
    };
    if system {
        return Err(AppError::msg("不能从此菜单删除系统库或系统对象"));
    }
    match object_kind {
        "database"
            if matches!(
                kind,
                DbKind::Mysql | DbKind::Mariadb | DbKind::Postgres | DbKind::Clickhouse
            ) =>
        {
            Ok(format!("DROP DATABASE {}", ident(kind, database)?))
        }
        "table" => {
            let namespace = match kind {
                DbKind::Postgres | DbKind::Oracle => schema,
                DbKind::Sqlite => {
                    if schema.is_empty() {
                        "main"
                    } else {
                        schema
                    }
                }
                _ => database,
            };
            Ok(format!(
                "DROP TABLE {}.{}",
                ident(kind, namespace)?,
                ident(kind, table)?
            ))
        }
        _ => Err(AppError::msg(
            "此对象不支持删除；SQLite 文件和 Oracle 用户不作为数据库删除",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quotes_exact_identifiers_and_never_cascades() {
        assert_eq!(
            statement(
                DbKind::Mysql,
                "table",
                "odd`db",
                "",
                "a`; DROP DATABASE other;--"
            )
            .unwrap(),
            "DROP TABLE `odd``db`.`a``; DROP DATABASE other;--`"
        );
        assert_eq!(
            statement(DbKind::Postgres, "table", "db", "odd\"schema", "t").unwrap(),
            "DROP TABLE \"odd\"\"schema\".\"t\""
        );
        assert_eq!(
            statement(DbKind::Clickhouse, "database", "test", "", "").unwrap(),
            "DROP DATABASE `test`"
        );
        assert!(statement(DbKind::Mysql, "database", "mysql", "", "").is_err());
        assert!(statement(DbKind::Sqlite, "database", "main", "", "").is_err());
        assert!(statement(DbKind::Mysql, "view", "db", "", "v").is_err());
        assert!(statement(DbKind::Postgres, "table", "db", "", "t").is_err());
    }
    #[tokio::test]
    async fn drops_only_requested_table_in_disposable_database() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE keep_me (value INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE \"odd; name\" (value INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        let sql = statement(DbKind::Sqlite, "table", "main", "main", "odd; name").unwrap();
        sqlx::query(&sql).execute(&pool).await.unwrap();
        let names: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type='table'")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(names, vec!["keep_me"]);
    }
}
