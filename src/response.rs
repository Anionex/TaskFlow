use axum::Json;
use serde::Serialize;
use serde_json::Value;

/// 统一响应格式：{ success, message, data? }（对齐设计文档 3.2）。
#[derive(Serialize)]
pub struct ApiResponse {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

pub fn ok(message: &str, data: impl Serialize) -> Json<ApiResponse> {
    Json(ApiResponse {
        success: true,
        message: message.to_string(),
        data: Some(serde_json::to_value(data).unwrap_or(Value::Null)),
    })
}

pub fn ok_msg(message: &str) -> Json<ApiResponse> {
    Json(ApiResponse {
        success: true,
        message: message.to_string(),
        data: None,
    })
}

pub fn err(message: &str) -> Json<ApiResponse> {
    Json(ApiResponse {
        success: false,
        message: message.to_string(),
        data: None,
    })
}
