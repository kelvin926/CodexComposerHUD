# Code signing policy

Maintainer, committer, reviewer and release approver: [kelvin926](https://github.com/kelvin926). The project uses the MIT license and publishes the source and release build workflow. See the [privacy policy](PRIVACY.md).

## Build signatures

Release builds use GitHub artifact attestations to bind an artifact digest to its source commit and workflow. Verify a downloaded artifact with:

```bash
gh attestation verify CodexComposerHUD-Setup.exe --repo kelvin926/CodexComposerHUD
```

The release also includes an attestation bundle for offline verification. An attestation establishes build provenance. It is separate from Windows Authenticode, macOS Developer ID and Apple notarization, and does not remove their operating-system warnings.

## Operating-system signing status

There is currently no trusted Windows code-signing certificate or Apple Developer ID certificate available to this project. Windows binaries remain unsigned and the Mac app uses an ad-hoc development signature. The Mac installer is not Developer ID signed or notarized.

A SignPath Foundation application is being prepared for free Windows signing. The project does not claim SignPath sponsorship or approval. Issuance depends on the provider's review and terms. Only project-owned executables may be signed under a future project policy; bundled upstream Node binaries retain their upstream identity.

For Apple signing, Developer ID Application and Developer ID Installer identities plus notarization credentials are required. No paid membership or certificate purchase is performed automatically.

Official references: [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations), [Windows signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), [SignPath eligibility](https://signpath.org/terms.html), [Apple Developer ID](https://developer.apple.com/help/account/certificates/create-developer-id-certificates).
