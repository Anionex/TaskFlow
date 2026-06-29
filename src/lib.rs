pub mod server;

/// 启动服务器（阻塞调用）
pub fn run_server() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(server::run_server());
}
