# Privacy

Codex Composer HUD is an unofficial, open-source companion. It does not read or export account passwords, cookies, access tokens, or authentication configuration.

The companion attaches to the desktop app through a localhost debugging connection and uses the app's existing interfaces to request usage, thread metadata and context settings. These requests use the official app's normal account connection. The companion does not operate an external data collection service.

Local session files can contain conversation content. The companion reads them locally and extracts token counters, model and speed metadata, task timestamps and rate-limit observations. It does not send conversation text or these files to the project maintainers or a signing service. Comparing current-week local records is necessary for the chat-level quota estimate.

Local state, diagnostic messages without conversation text, and backups of changed launch entries are stored in the user's application state directory. Automatic connection registers a login entry and redirects recognized personal Codex launch entries. Disabling automatic connection restores entries that still belong to the companion. Existing app files and authentication settings are not modified.

The localhost debugging port permits other programs running on the same computer to debug the app. It is closed when the official app fully exits. No remote debugging listener is intentionally exposed.

Public release files and build attestations contain source and build metadata. They do not include user session files, local state, shortcut backups or credentials. The official app has its own privacy policies and account services.
