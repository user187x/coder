#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    coder_network::run().await
}
