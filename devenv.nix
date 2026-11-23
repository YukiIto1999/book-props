{ pkgs, ... }:
{
  languages.rust.enable = true;
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };

  env = {
    BOOK_PROPS_TEST_DBUS_CONFIG = "${pkgs.dbus}/share/dbus-1/session.conf";
    NX_DAEMON = "false";
    NX_ISOLATE_PLUGINS = "false";
  };

  packages = [
    pkgs.cargo-mutants
    pkgs.dbus
    pkgs.glib
    pkgs.gnome-keyring
    pkgs.esbuild
    pkgs.jq
    pkgs.libsecret
    pkgs.lld
    pkgs.oxfmt
    pkgs.oxlint
    pkgs.python3
    pkgs.wasm-bindgen-cli
  ];

  profiles.release.module =
    let
      rustRevision = "8bab26f4f68e0e26f0bb7960be334d5b520ea452";
      rustNotice = name: hash: pkgs.fetchurl {
        inherit hash;
        url = "https://raw.githubusercontent.com/rust-lang/rust/${rustRevision}/${name}";
      };
    in
    {
      env = {
        BOOK_PROPS_RUST_REVISION = rustRevision;
        BOOK_PROPS_RUST_LIBRARY = "${pkgs.rustPlatform.rustLibSrc}";
        BOOK_PROPS_RUST_COPYRIGHT = "${rustNotice "COPYRIGHT" "sha256-FyAg2/1bU6Im3953YWGQpI3P9RmwvA5t65GoRQeCxK8="}";
        BOOK_PROPS_RUST_LICENSE_APACHE = "${rustNotice "LICENSE-APACHE" "sha256-Yseh419WQGiW16p8pS0MwNJyrAIrXSeW59aQXbijY2o="}";
        BOOK_PROPS_RUST_LICENSE_MIT = "${rustNotice "LICENSE-MIT" "sha256-txvUOgacoGQans/lhcp7PFO1zBYI+LaDIRaGmOKLXqE="}";
      };
      packages = [
        pkgs.cosign
        pkgs.osv-scanner
        pkgs.syft
      ];
    };

}
