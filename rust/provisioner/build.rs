use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=CODER_EMBEDDED_ENGINE_PATH");
    println!("cargo:rerun-if-env-changed=CODER_EMBEDDED_ENGINE_SHA256");
    println!("cargo:rerun-if-env-changed=CODER_EMBEDDED_ENGINE_KIND");
    println!("cargo:rerun-if-env-changed=CODER_EMBEDDED_ENGINE_LICENSE_PATH");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let generated = if let Some(path) = env::var_os("CODER_EMBEDDED_ENGINE_PATH") {
        let path = fs::canonicalize(path).expect("embedded engine file");
        println!("cargo:rerun-if-changed={}", path.display());
        let bytes = fs::read(&path).expect("read embedded engine");
        assert!(!bytes.is_empty(), "engine must not be empty");
        let digest = format!("{:x}", Sha256::digest(&bytes));
        let expected = env::var("CODER_EMBEDDED_ENGINE_SHA256")
            .expect("Supply the verified executable's CODER_EMBEDDED_ENGINE_SHA256");
        assert_eq!(
            digest,
            expected.to_ascii_lowercase(),
            "embedded engine SHA-256 mismatch"
        );
        let kind = env::var("CODER_EMBEDDED_ENGINE_KIND")
            .expect("Set CODER_EMBEDDED_ENGINE_KIND=terraform or opentofu");
        assert!(
            matches!(kind.as_str(), "terraform" | "opentofu"),
            "unsupported embedded engine kind"
        );
        let license = env::var_os("CODER_EMBEDDED_ENGINE_LICENSE_PATH")
            .expect("Supply the engine's license file");
        let license = fs::canonicalize(license).expect("engine license path");
        println!("cargo:rerun-if-changed={}", license.display());
        fs::copy(license, out.join("ENGINE-LICENSE.txt")).expect("copy engine license");
        fs::write(out.join("engine.bin"), bytes).expect("copy engine");
        format!(
            r#"pub const ENGINE_LICENSE: Option<&str> = Some(include_str!(concat!(env!("OUT_DIR"), "/ENGINE-LICENSE.txt")));
pub const EMBEDDED: Option<(&str, &[u8])> = Some(({kind:?}, include_bytes!(concat!(env!("OUT_DIR"), "/engine.bin"))));
"#
        )
    } else {
        "pub const ENGINE_LICENSE: Option<&str> = None;\npub const EMBEDDED: Option<(&str, &[u8])> = None;\n".into()
    };
    fs::write(out.join("embedded.rs"), generated).expect("write embedding metadata");
}
