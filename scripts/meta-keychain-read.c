#include <Security/Security.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  if (argc != 3) return 1;
  SecKeychainRef keychain = NULL;
  OSStatus openStatus = SecKeychainOpen(argv[1], &keychain);
  if (openStatus != errSecSuccess) { fprintf(stderr, "OPEN:%d\n", (int)openStatus); return 1; }
  const char *account = "development";
  UInt32 length = 0;
  void *password = NULL;
  OSStatus status = SecKeychainFindGenericPassword(keychain,
    (UInt32)strlen(argv[2]), argv[2], (UInt32)strlen(account), account,
    &length, &password, NULL);
  CFRelease(keychain);
  if (status == errSecItemNotFound) return 44;
  if (status != errSecSuccess || password == NULL) { fprintf(stderr, "READ:%d\n", (int)status); return 1; }
  size_t written = fwrite(password, 1, length, stdout);
  SecKeychainItemFreeContent(NULL, password);
  if (written != length || fflush(stdout) != 0) { fprintf(stderr, "OUTPUT:1\n"); return 1; }
  return 0;
}
