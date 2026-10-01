using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("Codex Composer HUD Setup")]
[assembly: AssemblyVersion("1.6.0.0")]
[assembly: AssemblyFileVersion("1.6.0.0")]

internal static class Setup {
    [STAThread]
    private static int Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        try {
            if (args.Contains("--silent")) { Install(true, !args.Contains("--no-auto"), null); if (args.Contains("--launch")) InstallSupport.Launch(InstallSupport.Root); return 0; }
            if (args.Length == 2 && args[0] == "--preview") { using (SetupForm form = new SetupForm()) { form.StartPosition = FormStartPosition.Manual; form.Location = new Point(-32000, -32000); form.ShowInTaskbar = false; form.Opacity = 0; form.Show(); Application.DoEvents(); form.PerformLayout(); using (Bitmap image = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(image, new Rectangle(0, 0, form.Width, form.Height)); image.Save(args[1]); } form.Close(); } return 0; }
            Application.Run(new SetupForm()); return 0;
        } catch (Exception error) { InstallSupport.Log("Install error: " + error.Message); if (!args.Contains("--silent")) MessageBox.Show(error.Message, "설치 오류", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
    }
    internal static void Install(bool desktop, bool automatic, Action<int, string> progress) {
        string root = InstallSupport.ResolveRoot(InstallSupport.Root);
        if (Directory.Exists(root) && Directory.GetFileSystemEntries(root).Length > 0) InstallSupport.AssertOwned(root);
        if (progress != null) progress(0, "기존 표시기를 종료하는 중..."); InstallSupport.StopHud();
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, ".installed-by-codex-hud"), InstallSupport.Identity, System.Text.Encoding.UTF8);
        List<string> manifest = new List<string>(); long total = 0, completed = 0;
        using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")) {
            if (payload == null) throw new IOException("설치 파일을 찾을 수 없습니다.");
            using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read)) {
                foreach (ZipArchiveEntry entry in archive.Entries) total += entry.Length;
                foreach (ZipArchiveEntry entry in archive.Entries) {
                    const string prefix = "CodexComposerHUD/";
                    if (!entry.FullName.StartsWith(prefix, StringComparison.Ordinal) || entry.FullName.EndsWith("/")) continue;
                    string relative = entry.FullName.Substring(prefix.Length).Replace('/', Path.DirectorySeparatorChar);
                    string file = InstallSupport.ResolveFile(root, relative); Directory.CreateDirectory(Path.GetDirectoryName(file));
                    bool written = false;
                    for (int retry = 0; !written; retry++) {
                        try { using (Stream source = entry.Open()) using (FileStream output = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.None)) source.CopyTo(output); written = true; }
                        catch (IOException) { if (retry >= 20) throw; Thread.Sleep(250); }
                    }
                    manifest.Add(relative); completed += entry.Length;
                    if (progress != null) progress((int)(completed * 90 / Math.Max(1, total)), "프로그램 파일을 설치하는 중...");
                }
            }
        }
        File.WriteAllText(Path.Combine(root, ".installed-by-codex-hud"), InstallSupport.Identity, System.Text.Encoding.UTF8);
        File.WriteAllLines(Path.Combine(root, "installed-files.txt"), manifest, System.Text.Encoding.UTF8);
        InstallSupport.Shortcut(Path.Combine(InstallSupport.Menu, "Codex Composer HUD.lnk"), Path.Combine(root, "Codex Composer HUD.exe"), root);
        InstallSupport.Shortcut(Path.Combine(InstallSupport.Menu, "표시기 종료.lnk"), Path.Combine(root, "Stop HUD.exe"), root);
        InstallSupport.Shortcut(Path.Combine(InstallSupport.Menu, "프로그램 제거.lnk"), Path.Combine(root, "Uninstall.exe"), root);
        if (desktop) InstallSupport.Shortcut(InstallSupport.DesktopLink, Path.Combine(root, "Codex Composer HUD.exe"), root);
        InstallSupport.Shortcut(Path.Combine(InstallSupport.Menu, "자동 연결 끄기.lnk"), Path.Combine(root, "Codex Composer HUD.exe"), root, "--disable-auto");
        if (automatic) AutoLaunch.Enable(root); else AutoLaunch.Disable(root);
        InstallSupport.Register(root, total); InstallSupport.Log("Installed " + InstallSupport.Version + " to " + root);
        if (progress != null) progress(100, "설치 완료");
    }
}
internal sealed class SetupForm : Form {
    private readonly ProgressBar progress = new ProgressBar();
    private readonly Label status = new Label();
    private readonly Button install = new Button(), cancel = new Button();
    private readonly CheckBox desktop = new CheckBox(), launch = new CheckBox(), automatic = new CheckBox();
    private bool completed;
    internal SetupForm() {
        Text = "Codex Composer HUD 설치"; Font = new Font("Malgun Gothic", 9F); ClientSize = new Size(530, 388);
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); BackColor = Color.White;
        Controls.Add(new Label { Text = "Codex Composer HUD", Font = new Font("Malgun Gothic", 17F, FontStyle.Bold), Location = new Point(24, 22), AutoSize = true });
        Controls.Add(new Label { Text = "컨텍스트, 사용 한도, 비용을 입력창에서 확인합니다.", Location = new Point(25, 64), AutoSize = true });
        Controls.Add(new Label { Text = "설치 위치", Location = new Point(25, 103), AutoSize = true });
        Controls.Add(new TextBox { Text = InstallSupport.Root, ReadOnly = true, BorderStyle = BorderStyle.FixedSingle, Location = new Point(25, 126), Size = new Size(480, 25) });
        desktop.Text = "바탕화면에 실행 아이콘 만들기"; desktop.Checked = true; desktop.Location = new Point(25, 171); desktop.AutoSize = true; Controls.Add(desktop);
        launch.Text = "설치 후 표시기 실행"; launch.Checked = true; launch.Location = new Point(25, 198); launch.AutoSize = true; Controls.Add(launch);
        automatic.Text = "Codex 자동 연결 (바로가기 연결 및 로그인 시 대기)"; automatic.Checked = true; automatic.Location = new Point(25, 225); automatic.AutoSize = true; Controls.Add(automatic);
        status.Text = "v1.6.0 / 현재 사용자에게 설치"; status.Location = new Point(25, 279); status.Size = new Size(480, 22); Controls.Add(status);
        progress.Location = new Point(25, 304); progress.Size = new Size(480, 9); Controls.Add(progress);
        install.Text = "설치"; install.Location = new Point(333, 338); install.Size = new Size(80, 30); Controls.Add(install);
        cancel.Text = "닫기"; cancel.Location = new Point(425, 338); cancel.Size = new Size(80, 30); cancel.Click += (s, e) => Close(); Controls.Add(cancel);
        AcceptButton = install; CancelButton = cancel;
        install.Click += async (s, e) => {
            if (completed) { Close(); return; }
            install.Enabled = cancel.Enabled = desktop.Enabled = launch.Enabled = automatic.Enabled = false;
            try {
                bool desktopSelected = desktop.Checked;
                bool automaticSelected = automatic.Checked;
                await Task.Run(() => Setup.Install(desktopSelected, automaticSelected, (value, text) => BeginInvoke((Action)(() => { progress.Value = value; status.Text = text; }))));
                completed = true; status.Text = "설치 완료. 시작 메뉴에서도 실행할 수 있습니다."; install.Text = "완료";
                if (launch.Checked) InstallSupport.Launch(InstallSupport.Root);
            } catch (Exception error) { status.Text = "설치에 실패했습니다."; MessageBox.Show(this, error.Message, "설치 오류", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            install.Enabled = cancel.Enabled = true;
        };
    }
}
