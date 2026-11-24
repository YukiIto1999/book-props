{ pkgs, ... }:
{
  languages.rust.enable = true;
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };

  env = {
    BOOK_PROPS_WASM_CLANG = "${pkgs.llvmPackages.clang-unwrapped}/bin/clang";
    NX_DAEMON = "false";
    NX_ISOLATE_PLUGINS = "false";
  };

  packages = [
    pkgs.cargo-mutants
    pkgs.glib
    pkgs.esbuild
    pkgs.jq
    pkgs.lld
    pkgs.oxfmt
    pkgs.oxlint
    pkgs.python3
    pkgs.wasm-bindgen-cli
  ];

  profiles.release.module =
    let
      rustRevision = "8bab26f4f68e0e26f0bb7960be334d5b520ea452";
      rustNotices = ./tools/release/rust + "/${rustRevision}";
    in
    {
      env = {
        BOOK_PROPS_RUST_REVISION = rustRevision;
        BOOK_PROPS_RUST_LIBRARY = "${pkgs.rustPlatform.rustLibSrc}";
        BOOK_PROPS_RUST_COPYRIGHT = "${rustNotices}/COPYRIGHT";
        BOOK_PROPS_RUST_LICENSE_APACHE = "${rustNotices}/LICENSE-APACHE";
        BOOK_PROPS_RUST_LICENSE_MIT = "${rustNotices}/LICENSE-MIT";
      };
      packages = [
        pkgs.osv-scanner
        pkgs.syft
      ];
    };

}
