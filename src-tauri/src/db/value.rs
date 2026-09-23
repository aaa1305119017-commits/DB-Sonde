//! Converting driver rows into JSON cells the frontend can render.
//!
//! Each engine has its own decode order. We try the concrete Rust types a
//! column could hold, in an order chosen so nothing gets mangled (integers
//! before floats, decimals kept as exact strings, booleans only where the
//! engine has a real boolean type). A SQL `NULL` decodes as `Ok(None)` on the
//! first compatible attempt, so nulls are handled naturally.

use bigdecimal::BigDecimal;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::{Column, Row, TypeInfo};
use uuid::Uuid;

/// JSON numbers outside JavaScript's exact integer range must travel as text.
pub fn exact_integer(v: impl Into<i128>) -> Value {
    let n = v.into();
    if (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&n) {
        Value::from(n as i64)
    } else {
        Value::String(n.to_string())
    }
}

/// Normalize scalar JSON integers from drivers whose JSON format can emit
/// unquoted UInt64/Int64 values (e.g. ClickHouse with custom output settings).
pub fn exact_json_integer(value: Value) -> Value {
    match value {
        Value::Number(ref n) if n.is_i64() => exact_integer(n.as_i64().unwrap()),
        Value::Number(ref n) if n.is_u64() => exact_integer(n.as_u64().unwrap()),
        other => other,
    }
}

/// Render a byte blob compactly: full hex when short, otherwise a truncated
/// preview plus the length.
fn bytes_to_value(bytes: Vec<u8>) -> Value {
    fn hex(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            s.push_str(&format!("{:02x}", b));
        }
        s
    }
    if bytes.len() <= 32 {
        Value::String(format!("0x{}", hex(&bytes)))
    } else {
        Value::String(format!("0x{}… ({} bytes)", hex(&bytes[..16]), bytes.len()))
    }
}

/// Try each `Type => closure` pair in order. Returns `Value::Null` when the
/// cell is SQL NULL, or falls through to `Value::Null` if nothing matched.
macro_rules! decode_chain {
    ($row:expr, $i:expr; $($t:ty => $f:expr),+ $(,)?) => {{
        $(
            match $row.try_get::<Option<$t>, _>($i) {
                Ok(Some(val)) => return ($f)(val),
                Ok(None) => return Value::Null,
                Err(_) => {}
            }
        )+
        Value::Null
    }};
}

pub fn mysql_value(row: &sqlx::mysql::MySqlRow, i: usize) -> Value {
    // sqlx also accepts VARCHAR/TEXT when decoding JSON. Trying JSON before
    // String would turn text IDs, "null", "true", or JSON-looking text into
    // different types, and long IDs would lose precision in the frontend.
    if row.column(i).type_info().name() == "JSON" {
        return row.try_get::<Value, _>(i).unwrap_or(Value::Null);
    }
    decode_chain!(row, i;
        i64 => exact_integer,
        u64 => exact_integer,
        Decimal => |v: Decimal| Value::String(v.to_string()),
        BigDecimal => |v: BigDecimal| Value::String(v.to_string()),
        f64 => |v: f64| Value::from(v),
        bool => |v: bool| Value::Bool(v),
        // 显示成 YYYY-MM-DD HH:MM:SS(与 NaiveDateTime 一致、对齐 DBeaver),
        // 不再输出 RFC3339 的 `T` 与 `+00:00` 后缀。
        DateTime<Utc> => |v: DateTime<Utc>| Value::String(v.format("%Y-%m-%d %H:%M:%S%.f").to_string()),
        NaiveDateTime => |v: NaiveDateTime| Value::String(v.format("%Y-%m-%d %H:%M:%S%.f").to_string()),
        NaiveDate => |v: NaiveDate| Value::String(v.to_string()),
        NaiveTime => |v: NaiveTime| Value::String(v.to_string()),
        String => |v: String| Value::String(v),
        Vec<u8> => |v: Vec<u8>| bytes_to_value(v),
    )
}

pub fn pg_value(row: &sqlx::postgres::PgRow, i: usize) -> Value {
    decode_chain!(row, i;
        bool => |v: bool| Value::Bool(v),
        i16 => |v: i16| Value::from(v),
        i32 => |v: i32| Value::from(v),
        i64 => exact_integer,
        Decimal => |v: Decimal| Value::String(v.to_string()),
        BigDecimal => |v: BigDecimal| Value::String(v.to_string()),
        f32 => |v: f32| Value::from(v as f64),
        f64 => |v: f64| Value::from(v),
        Uuid => |v: Uuid| Value::String(v.to_string()),
        // 显示成 YYYY-MM-DD HH:MM:SS(与 NaiveDateTime 一致、对齐 DBeaver),
        // 不再输出 RFC3339 的 `T` 与 `+00:00` 后缀。
        DateTime<Utc> => |v: DateTime<Utc>| Value::String(v.format("%Y-%m-%d %H:%M:%S%.f").to_string()),
        NaiveDateTime => |v: NaiveDateTime| Value::String(v.format("%Y-%m-%d %H:%M:%S%.f").to_string()),
        NaiveDate => |v: NaiveDate| Value::String(v.to_string()),
        NaiveTime => |v: NaiveTime| Value::String(v.to_string()),
        serde_json::Value => |v: serde_json::Value| v,
        String => |v: String| Value::String(v),
        Vec<u8> => |v: Vec<u8>| bytes_to_value(v),
    )
}

pub fn sqlite_value(row: &sqlx::sqlite::SqliteRow, i: usize) -> Value {
    decode_chain!(row, i;
        i64 => exact_integer,
        f64 => |v: f64| Value::from(v),
        String => |v: String| Value::String(v),
        Vec<u8> => |v: Vec<u8>| bytes_to_value(v),
    )
}

/// Build `(name, type_name)` column metadata from any sqlx row.
pub fn columns_from_row<R>(row: &R) -> Vec<crate::models::ColumnMeta>
where
    R: Row,
{
    row.columns()
        .iter()
        .map(|c| crate::models::ColumnMeta {
            name: c.name().to_string(),
            type_name: c.type_info().to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{mysql::MySqlConnectOptions, Connection, MySqlConnection};

    /// Uses SELECT-only fixtures against an explicitly supplied MySQL server.
    #[tokio::test]
    #[ignore = "requires SONDE_TEST_MYSQL_HOST, SONDE_TEST_MYSQL_USER and SONDE_TEST_MYSQL_PASSWORD"]
    async fn mysql_text_json_and_integer_types_stay_distinct() {
        let options = MySqlConnectOptions::new()
            .host(&std::env::var("SONDE_TEST_MYSQL_HOST").expect("test MySQL host"))
            .port(
                std::env::var("SONDE_TEST_MYSQL_PORT")
                    .unwrap_or_else(|_| "3306".into())
                    .parse()
                    .expect("test MySQL port"),
            )
            .username(&std::env::var("SONDE_TEST_MYSQL_USER").expect("test MySQL user"))
            .password(&std::env::var("SONDE_TEST_MYSQL_PASSWORD").expect("test MySQL password"));
        let mut conn = MySqlConnection::connect_with(&options).await.unwrap();
        sqlx::query("SET SESSION TRANSACTION READ ONLY")
            .execute(&mut conn)
            .await
            .unwrap();
        sqlx::query("SET SESSION max_execution_time = 5000")
            .execute(&mut conn)
            .await
            .unwrap();

        for text in [
            "1041027043025829888",
            "9007199254740993",
            "000123",
            "12.3400",
            "null",
            "true",
            "false",
            "{\"id\":1}",
            "[1,2]",
            "\"quoted\"",
            " 123 ",
            "",
            "会员",
        ] {
            let row = sqlx::query("SELECT CAST(? AS CHAR) AS sample")
                .bind(text)
                .fetch_one(&mut conn)
                .await
                .unwrap();
            let cell = mysql_value(&row, 0);
            assert_eq!(cell, Value::String(text.into()), "text fixture {text:?}");
            assert_eq!(
                serde_json::to_string(&cell).unwrap(),
                serde_json::to_string(text).unwrap()
            );
        }

        for json in [
            "{\"id\":1}",
            "[1,true,null]",
            "\"hello\"",
            "12",
            "true",
            "null",
        ] {
            let row = sqlx::query("SELECT CAST(? AS JSON) AS sample")
                .bind(json)
                .fetch_one(&mut conn)
                .await
                .unwrap();
            assert_eq!(row.column(0).type_info().name(), "JSON");
            assert_eq!(
                mysql_value(&row, 0),
                serde_json::from_str::<Value>(json).unwrap()
            );
        }

        let row = sqlx::query("SELECT CAST(NULL AS CHAR), CAST(NULL AS JSON), CAST(1041027043025829888 AS SIGNED), CAST(18446744073709551615 AS UNSIGNED), CAST(12.3400 AS DECIMAL(10,4)), CAST(42 AS SIGNED)")
            .fetch_one(&mut conn).await.unwrap();
        assert_eq!(
            (0..row.len())
                .map(|i| mysql_value(&row, i))
                .collect::<Vec<_>>(),
            vec![
                Value::Null,
                Value::Null,
                Value::String("1041027043025829888".into()),
                Value::String("18446744073709551615".into()),
                Value::String("12.3400".into()),
                Value::from(42),
            ]
        );
        conn.close().await.unwrap();
    }
}
