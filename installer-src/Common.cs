using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

internal static class InstallSupport {
    internal const string Product = "CodexComposerHUD";
    internal const string Version = "1.6.1";
    internal const string Identity = "codex-composer-hud-4ca0723b-953c-4914-b48c-bb97ad3f0474";
    internal const string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\CodexComposerHUD";
    internal static string Root { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Product); } }
    internal static string Menu { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Codex Composer HUD"); } }
    internal static string DesktopLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Codex Composer HUD.lnk"); } }
    internal static string ResolveRoot(string candidate) {
        string resolved = Path.GetFullPath(candidate).TrimEnd(Path.DirectorySeparatorChar);
        if (!String.Equals(resolved, Path.GetFullPath(Root).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) throw new IOException("설치 경로가 올바르지 않습니다.");
        if (Directory.Exists(resolved) && (File.GetAttributes(resolved) & FileAttributes.ReparsePoint) != 0) throw new IOException("연결된 설치 폴더는 변경하지 않습니다.");
        return resolved;
    }
    internal static string ResolveFile(string root, string relative) {
        string full = Path.GetFullPath(Path.Combine(root, relative));
        if (!full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("프로그램 폴더 밖의 파일은 변경할 수 없습니다.");
        for (string directory = Path.GetDirectoryName(full); directory != null && directory.StartsWith(root, StringComparison.OrdinalIgnoreCase); directory = Path.GetDirectoryName(directory)) {
            if (Directory.Exists(directory) && (File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new IOException("연결된 프로그램 폴더는 변경하지 않습니다.");
            if (String.Equals(directory, root, StringComparison.OrdinalIgnoreCase)) break;
        }
        if (File.Exists(full) && (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new IOException("연결된 프로그램 파일은 변경하지 않습니다.");
        return full;
    }
    internal static void AssertOwned(string root) {
        ResolveRoot(root);
        string marker = Path.Combine(root, ".installed-by-codex-hud");
        if (!File.Exists(marker) || File.ReadAllText(marker, Encoding.UTF8).Trim() != Identity) throw new IOException("이 프로그램이 설치한 폴더인지 확인할 수 없습니다.");
    }
    internal static void StopHud() {
        byte[] hash;
        using (SHA256 sha = SHA256.Create()) hash = sha.ComputeHash(Encoding.UTF8.GetBytes(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)));
        string suffix = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant().Substring(0, 16);
        try {
            using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", "codex-composer-hud-" + suffix, PipeDirection.Out)) {
                pipe.Connect(1000); byte[] message = Encoding.UTF8.GetBytes("stop"); pipe.Write(message, 0, message.Length); pipe.Flush();
            }
        } catch (TimeoutException) {} catch (IOException) {}
    }
    internal static void Shortcut(string link, string target, string root, string arguments = "") {
        Directory.CreateDirectory(Path.GetDirectoryName(link));
        Type shellType = Type.GetTypeFromProgID("WScript.Shell"); object shell = Activator.CreateInstance(shellType), shortcut = null;
        try {
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
            Type type = shortcut.GetType();
            type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
            type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { root });
            type.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { arguments });
            type.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { Path.Combine(root, "Codex Composer HUD.exe") + ",0" });
            type.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "Codex 입력창 사용량 표시" });
            type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        } finally { if (shortcut != null) Marshal.FinalReleaseComObject(shortcut); Marshal.FinalReleaseComObject(shell); }
    }
    internal static void DeleteOwnedShortcut(string link, string root) {
        if (!File.Exists(link)) return;
        Type shellType = Type.GetTypeFromProgID("WScript.Shell"); object shell = Activator.CreateInstance(shellType), shortcut = null;
        try {
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
            string target = Convert.ToString(shortcut.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null));
            if (Path.GetFullPath(target).StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) File.Delete(link);
        } finally { if (shortcut != null) Marshal.FinalReleaseComObject(shortcut); Marshal.FinalReleaseComObject(shell); }
    }
    internal static void Register(string root, long size) {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RegistryPath)) {
            key.SetValue("DisplayName", "Codex Composer HUD"); key.SetValue("DisplayVersion", Version); key.SetValue("Publisher", "Codex Composer HUD");
            key.SetValue("InstallLocation", root); key.SetValue("DisplayIcon", Path.Combine(root, "Codex Composer HUD.exe"));
            key.SetValue("UninstallString", "\"" + Path.Combine(root, "Uninstall.exe") + "\"");
            key.SetValue("QuietUninstallString", "\"" + Path.Combine(root, "Uninstall.exe") + "\" --silent");
            key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd")); key.SetValue("EstimatedSize", (int)(size / 1024), RegistryValueKind.DWord);
            key.SetValue("NoModify", 1, RegistryValueKind.DWord); key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }
    internal static void Log(string message) {
        string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product);
        Directory.CreateDirectory(directory); File.AppendAllText(Path.Combine(directory, "install.log"), DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine, Encoding.UTF8);
    }
    internal static void Launch(string root) { Process.Start(new ProcessStartInfo(Path.Combine(root, "Codex Composer HUD.exe")) { WorkingDirectory = root, UseShellExecute = true }); }
}
