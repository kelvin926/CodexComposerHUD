using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Codex Composer HUD Uninstall")]
[assembly: AssemblyVersion("1.4.0.0")]
[assembly: AssemblyFileVersion("1.4.0.0")]

internal static class Uninstall {
    [STAThread]
    private static int Main(string[] args) {
        bool silent = args.Contains("--silent");
        try {
            string root = InstallSupport.ResolveRoot(InstallSupport.Root); InstallSupport.AssertOwned(root);
            if (args.Contains("--verify")) { ValidateManifest(root); InstallSupport.Log("Uninstall manifest verified."); return 0; }
            if (!args.Contains("--perform")) {
                if (!silent && MessageBox.Show("Codex Composer HUD를 제거할까요?", "프로그램 제거", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 0;
                string temporary = Path.Combine(Path.GetTempPath(), "CodexComposerHUD-Uninstall", Guid.NewGuid().ToString("N")); Directory.CreateDirectory(temporary);
                string helper = Path.Combine(temporary, "Uninstall.exe"); File.Copy(Application.ExecutablePath, helper);
                Process.Start(new ProcessStartInfo(helper, "--perform" + (silent ? " --silent" : "")) { UseShellExecute = false, CreateNoWindow = silent }); return 0;
            }
            string[] manifest = ValidateManifest(root); InstallSupport.StopHud();
            foreach (string relative in manifest) {
                string file = InstallSupport.ResolveFile(root, relative);
                for (int attempt = 0; File.Exists(file); attempt++) { try { File.Delete(file); } catch (IOException) { if (attempt >= 20) throw; System.Threading.Thread.Sleep(250); } }
            }
            InstallSupport.DeleteOwnedShortcut(InstallSupport.DesktopLink, root);
            foreach (string name in new[] { "Codex Composer HUD.lnk", "표시기 종료.lnk", "프로그램 제거.lnk" }) InstallSupport.DeleteOwnedShortcut(Path.Combine(InstallSupport.Menu, name), root);
            if (Directory.Exists(InstallSupport.Menu) && Directory.GetFileSystemEntries(InstallSupport.Menu).Length == 0) Directory.Delete(InstallSupport.Menu);
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(InstallSupport.RegistryPath)) {
                if (key != null && String.Equals(Convert.ToString(key.GetValue("InstallLocation")), root, StringComparison.OrdinalIgnoreCase)) { key.Close(); Registry.CurrentUser.DeleteSubKeyTree(InstallSupport.RegistryPath, false); }
            }
            File.Delete(Path.Combine(root, "installed-files.txt")); File.Delete(Path.Combine(root, ".installed-by-codex-hud"));
            DeleteEmptyDirectories(root); InstallSupport.Log("Uninstalled " + InstallSupport.Version);
            if (!silent) MessageBox.Show("제거가 완료되었습니다.", "Codex Composer HUD", MessageBoxButtons.OK, MessageBoxIcon.Information); return 0;
        } catch (Exception error) { InstallSupport.Log("Uninstall error: " + error.Message); if (!silent) MessageBox.Show(error.Message, "제거 오류", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
    }
    private static string[] ValidateManifest(string root) {
        InstallSupport.AssertOwned(root);
        string[] files = File.ReadAllLines(Path.Combine(root, "installed-files.txt"), System.Text.Encoding.UTF8);
        foreach (string file in files) InstallSupport.ResolveFile(root, file);
        return files;
    }
    private static void DeleteEmptyDirectories(string directory) {
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) return;
        foreach (string child in Directory.GetDirectories(directory)) DeleteEmptyDirectories(child);
        if (Directory.GetFileSystemEntries(directory).Length == 0) Directory.Delete(directory);
    }
}
