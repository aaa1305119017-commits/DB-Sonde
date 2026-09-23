use serde::Serialize;

/// Application error type. Serializes to a plain string so the frontend receives
/// a readable message from every failed command.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Db(#[from] sqlx::Error),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),

    #[error("no active connection: {0}")]
    NotConnected(String),

    #[error("connection not found: {0}")]
    UnknownConnection(String),

    #[error("{0}")]
    Message(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Message(s.into())
    }
}

pub type AppResult<T> = Result<T, AppError>;
