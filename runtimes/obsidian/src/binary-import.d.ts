declare module "*.wasm" {
  const binary: Uint8Array<ArrayBuffer>;
  export default binary;
}
