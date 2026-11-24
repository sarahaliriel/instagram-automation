export function buildCreateArgs(service) {
  // The native hidden prompt works only with -w as the final argument.
  // A keychain positional argument before -w ends security's option parsing.
  return ["add-generic-password", "-a", "development", "-s", service, "-w"];
}

export function assertLoginDefault(output, loginKeychain) {
  const path = output.trim().replace(/^"|"$/g, "");
  if (path !== loginKeychain) {
    throw new Error("The user default Keychain is not login");
  }
}
