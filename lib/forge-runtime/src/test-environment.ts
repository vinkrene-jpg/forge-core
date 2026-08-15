for (const name of Object.keys(process.env)) {
  if (name.startsWith("FORGE_")) {
    delete process.env[name];
  }
}