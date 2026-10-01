using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

internal static class AutoLaunch {
    private const string RunPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private static string StateRoot { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodexComposerHUD", "auto-launch"); } }
    private static string Manifest { get { return Path.Combine(StateRoot, "shortcuts.tsv"); } }
    private static string[] Folders { get { return new[] { Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Environment.GetFolderPath(Environment.SpecialFolder.Programs), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar") }; } }
    private static bool Allowed(string file) {
        string full = Path.GetFullPath(file);
        foreach (string folder in Folders) if (full.StartsWith(Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }
    private static IEnumerable<string> Links(string directory) {
        if (!Directory.Exists(directory) || (File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) yield break;
        foreach (string file in Directory.GetFiles(directory, "*.lnk")) if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0) yield return file;
        foreach (string child in Directory.GetDirectories(directory)) foreach (string file in Links(child)) yield return file;
    }
    private static string Encode(string value) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(value)); }
    private static string Decode(string value) { return Encoding.UTF8.GetString(Convert.FromBase64String(value)); }
    private static string Key(string value) { using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value.ToLowerInvariant()))).Replace("-", "").ToLowerInvariant(); }
    private static Dictionary<string, string> ReadManifest() {
        Dictionary<string, string> rows = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(Manifest)) return rows;
        foreach (string line in File.ReadAllLines(Manifest, Encoding.UTF8)) { string[] fields = line.Split('\t'); if (fields.Length == 2) { string file = Decode(fields[0]); if (Allowed(file)) rows[file] = fields[1]; } }
        return rows;
    }
    private static object Open(object shell, string file) { return shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { file }); }
    private static string Get(object link, string name) { return Convert.ToString(link.GetType().InvokeMember(name, BindingFlags.GetProperty, null, link, null)); }
    private static void Set(object link, string name, string value) { link.GetType().InvokeMember(name, BindingFlags.SetProperty, null, link, new object[] { value }); }
    private static bool Native(string target) { return Regex.IsMatch(target, @"\\OpenAI\.Codex_[^\\]+\\app\\(?:ChatGPT|Codex)\.exe$", RegexOptions.IgnoreCase); }
    private static string NativeIcon(string icon, string originalTarget) {
        return icon.Split(',')[0].Trim().Length == 0 ? originalTarget + ",0" : icon;
    }
    private static string NativeTarget(object shell, Dictionary<string, string> rows) {
        foreach (string backup in rows.Values) {
            if (!Regex.IsMatch(backup, @"^[0-9a-f]{64}\.lnk$")) continue;
            string file = Path.Combine(StateRoot, backup); if (!File.Exists(file)) continue;
            object link = Open(shell, file);
            try { string target = Get(link, "TargetPath"); if (Native(target) && File.Exists(target)) return target; }
            finally { Marshal.FinalReleaseComObject(link); }
        }
        return null;
    }
    internal static void Enable(string root) {
        root = InstallSupport.ResolveRoot(root); InstallSupport.AssertOwned(root); Directory.CreateDirectory(StateRoot);
        Dictionary<string, string> rows = ReadManifest(); string target = Path.Combine(root, "Codex Composer HUD.exe");
        object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        try {
            string nativeTarget = NativeTarget(shell, rows);
            HashSet<string> visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string folder in Folders) foreach (string file in Links(folder)) {
                if (!Allowed(file) || !visited.Add(file)) continue;
                object link = Open(shell, file);
                try {
                    string originalTarget = Get(link, "TargetPath");
                    if (String.Equals(originalTarget, target, StringComparison.OrdinalIgnoreCase) && Get(link, "Arguments").StartsWith("--app-args", StringComparison.Ordinal)) {
                        string backupName;
                        if (rows.TryGetValue(file, out backupName) && Regex.IsMatch(backupName, @"^[0-9a-f]{64}\.lnk$") && File.Exists(Path.Combine(StateRoot, backupName))) {
                            object original = Open(shell, Path.Combine(StateRoot, backupName));
                            try { Set(link, "IconLocation", NativeIcon(Get(original, "IconLocation"), Get(original, "TargetPath"))); }
                            finally { Marshal.FinalReleaseComObject(original); }
                        } else if (nativeTarget != null) {
                            string currentIcon = Get(link, "IconLocation"), iconPath = currentIcon.Split(',')[0].Trim();
                            if (iconPath.Length == 0 || String.Equals(iconPath, target, StringComparison.OrdinalIgnoreCase)) Set(link, "IconLocation", nativeTarget + ",0");
                        }
                        link.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null); continue;
                    }
                    if (!Native(originalTarget)) continue;
                    nativeTarget = originalTarget;
                    if (Regex.IsMatch(Get(link, "Arguments"), @"--(?:remote-debugging|user-data-dir|inspect|codex-composer-hud)")) continue;
                    string backup = Key(file) + ".lnk";
                    if (!rows.ContainsKey(file)) { File.Copy(file, Path.Combine(StateRoot, backup), true); rows[file] = backup; }
                    string arguments = Get(link, "Arguments"), icon = Get(link, "IconLocation");
                    Set(link, "TargetPath", target); Set(link, "Arguments", "--app-args" + (arguments.Length > 0 ? " " + arguments : "")); Set(link, "WorkingDirectory", root);
                    Set(link, "IconLocation", NativeIcon(icon, originalTarget));
                    Set(link, "Description", "Codex 사용량 표시 자동 연결"); link.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
                } finally { Marshal.FinalReleaseComObject(link); }
            }
            string desktop = Path.Combine(Folders[0], "Codex.lnk");
            if (!File.Exists(desktop) && nativeTarget != null) {
                InstallSupport.Shortcut(desktop, target, root, "--app-args");
                object link = Open(shell, desktop);
                try { Set(link, "IconLocation", nativeTarget + ",0"); link.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null); }
                finally { Marshal.FinalReleaseComObject(link); }
                rows[desktop] = "created";
            }
        } finally { Marshal.FinalReleaseComObject(shell); }
        List<string> lines = new List<string>(); foreach (KeyValuePair<string,string> row in rows) lines.Add(Encode(row.Key) + "\t" + row.Value);
        File.WriteAllLines(Manifest, lines, Encoding.UTF8);
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RunPath)) key.SetValue("CodexComposerHUD", "\"" + target + "\" --watch --quiet");
        InstallSupport.Log("Automatic connection enabled; matching Codex shortcuts backed up.");
    }
    internal static void Disable(string root) {
        root = InstallSupport.ResolveRoot(root); string target = Path.Combine(root, "Codex Composer HUD.exe");
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunPath, true)) {
            if (key != null && String.Equals(Convert.ToString(key.GetValue("CodexComposerHUD")), "\"" + target + "\" --watch --quiet", StringComparison.OrdinalIgnoreCase)) key.DeleteValue("CodexComposerHUD", false);
        }
        object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        try {
            foreach (KeyValuePair<string,string> row in ReadManifest()) {
                if (!Allowed(row.Key) || !File.Exists(row.Key)) continue;
                object link = Open(shell, row.Key); bool ours;
                try { ours = String.Equals(Get(link, "TargetPath"), target, StringComparison.OrdinalIgnoreCase) && Get(link, "Arguments").StartsWith("--app-args", StringComparison.Ordinal); }
                finally { Marshal.FinalReleaseComObject(link); }
                if (!ours) continue;
                if (row.Value == "created") File.Delete(row.Key);
                else {
                    string backup = Path.Combine(StateRoot, row.Value);
                    if (row.Value != Path.GetFileName(row.Value) || !Regex.IsMatch(row.Value, @"^[0-9a-f]{64}\.lnk$")) continue;
                    if (File.Exists(backup)) File.Copy(backup, row.Key, true);
                }
            }
        } finally { Marshal.FinalReleaseComObject(shell); }
        InstallSupport.Log("Automatic connection disabled; unchanged owned shortcuts restored.");
    }
}
