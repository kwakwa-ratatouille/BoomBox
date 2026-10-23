// Installer Boombox sur iPhone : assistant pas à pas (Windows).
// Ce qu'il fait tout seul : vérifier le PC, installer iTunes (pilotes de l'iPhone) et iloader (l'installeur
// officiel de SideStore), détecter l'iPhone branché, lancer iloader, afficher les QR codes à scanner.
// Ce qui reste à faire sur l'iPhone (Apple ne permet pas de l'automatiser) est expliqué étape par étape, avec
// une page à suivre sur le téléphone (musikal-b72d1.web.app/iphone.html).
// Compilation : build.cmd (csc de .NET Framework 4, aucun outil à installer). Écrit en C# 5.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net;
using System.ServiceProcess;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Installer Boombox sur iPhone")]
[assembly: System.Reflection.AssemblyProduct("Boombox")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace BoomboxIphone
{
    class Step
    {
        public string Title;
        public string Body;
        public string Qr;          // ressource image du QR code (ou null)
        public string QrCaption;
        public Action<Wizard> OnShow;
    }

    class Wizard : Form
    {
        static readonly Color Bg = Color.FromArgb(18, 18, 18);
        static readonly Color Side = Color.FromArgb(26, 25, 30);
        static readonly Color Card = Color.FromArgb(34, 32, 40);
        static readonly Color Accent = Color.FromArgb(176, 124, 247);
        static readonly Color Ok = Color.FromArgb(46, 242, 139);
        static readonly Color Warn = Color.FromArgb(255, 176, 77);
        static readonly Color Muted = Color.FromArgb(169, 163, 181);
        const string ILOADER_MSI = "https://github.com/nab138/iloader/releases/latest/download/iloader-windows-x64.msi";
        const string ITUNES = "https://www.apple.com/itunes/download/win64";

        List<Step> steps = new List<Step>();
        int cur = 0;
        int reached = 0;
        Label[] sideItems;
        Label title, body, status, qrCaption;
        PictureBox qr;
        Button back, next, action, action2;
        Panel content;
        System.Windows.Forms.Timer poll;

        // Écrans avec zoom (125 %, 150 %…) : toutes les tailles fixes sont agrandies d’autant
        float S = 1f;
        int P(int v) { return (int)Math.Round(v * S); }

        public Wizard()
        {
            using (var g = CreateGraphics()) S = g.DpiX / 96f;
            Text = "Installer Boombox sur iPhone";
            ClientSize = new Size(P(1040), P(700));
            MinimumSize = new Size(P(960), P(640));
            var wa = Screen.PrimaryScreen.WorkingArea;
            if (Width > wa.Width || Height > wa.Height) WindowState = FormWindowState.Maximized;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Bg;
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 10.5f);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            BuildSteps();
            BuildUi();
            Show(0);
        }

        // ---------- Les étapes ----------
        void BuildSteps()
        {
            steps.Add(new Step {
                Title = "Bienvenue 👋",
                Body = "Ce programme t'installe Boombox sur ton iPhone, pas à pas. Compte environ 10 minutes.\n\n" +
                       "Il fait tout seul ce qui peut se faire depuis le PC. Pour le reste, il te dit exactement quoi toucher sur l'iPhone.\n\n" +
                       "Prépare :\n" +
                       "   •  ton iPhone (iOS 15 ou plus récent), avec son code de déverrouillage\n" +
                       "   •  le câble USB de l'iPhone\n" +
                       "   •  un identifiant Apple (gratuit : celui de ton iPhone ou un autre)\n" +
                       "   •  le Wi-Fi sur le PC et sur l'iPhone (pas la 4G)\n\n" +
                       "Clique sur « Suivant » pour commencer.",
                OnShow = w => w.CheckWindows()
            });
            steps.Add(new Step {
                Title = "1. Sur l'iPhone : installer LocalDevVPN",
                Body = "Scanne le QR code avec l'appareil photo de l'iPhone. Une page s'ouvre : elle reprend les mêmes étapes que ce programme, avec des boutons à toucher.\n\n" +
                       "Sur cette page, touche « Ouvrir LocalDevVPN dans l'App Store », puis :\n" +
                       "   1.  Touche « Obtenir » pour installer l'appli (gratuite).\n" +
                       "   2.  Ouvre LocalDevVPN et touche « Connect ».\n" +
                       "   3.  iOS demande d'ajouter un VPN : touche « Autoriser » et tape ton code.\n\n" +
                       "LocalDevVPN permet à SideStore d'installer et de renouveler Boombox depuis l'iPhone. Ce n'est pas un vrai VPN : rien ne sort du téléphone.\n\n" +
                       "Garde la page ouverte sur l'iPhone : elle resservira.",
                Qr = "qr_start.png",
                QrCaption = "Scanne avec l'appareil photo"
            });
            steps.Add(new Step {
                Title = "2. Préparer le PC",
                Body = "Le PC a besoin de deux choses :\n\n" +
                       "   •  iTunes : il contient les pilotes qui permettent au PC de parler à l'iPhone. Tu n'auras pas besoin de l'ouvrir.\n" +
                       "   •  iloader : l'installeur officiel de SideStore (l'appli qui installera Boombox).\n\n" +
                       "Clique sur « Tout installer ». Windows peut demander une autorisation : réponds « Oui ». Si l'installeur d'iTunes s'affiche, clique sur « Suivant » jusqu'à la fin.",
                OnShow = w => w.ShowPcStep()
            });
            steps.Add(new Step {
                Title = "3. Brancher l'iPhone",
                Body = "   1.  Branche l'iPhone au PC avec le câble USB.\n" +
                       "   2.  Déverrouille l'iPhone.\n" +
                       "   3.  Sur l'iPhone, touche « Se fier » (« Faire confiance à cet ordinateur ? ») et tape ton code.\n\n" +
                       "Le programme détecte l'iPhone tout seul : attends que la ligne ci-dessous passe au vert.\n\n" +
                       "Pas détecté ? Débranche puis rebranche le câble, essaie un autre port USB, ou redémarre le PC si iTunes vient d'être installé.",
                OnShow = w => w.StartDetect()
            });
            steps.Add(new Step {
                Title = "4. Installer SideStore avec iloader",
                Body = "Clique sur « Ouvrir iloader ». Dans la fenêtre d'iloader :\n\n" +
                       "   1.  Connecte-toi avec ton identifiant Apple (attention aux majuscules). Il est envoyé seulement à Apple, comme sur un iPhone.\n" +
                       "   2.  Choisis ton iPhone dans la liste.\n" +
                       "   3.  Clique sur « Install SideStore (Stable) » et attends la fin.\n\n" +
                       "Si Apple envoie un code de vérification sur tes appareils, tape-le dans iloader.\n\n" +
                       "L'iPhone doit rester branché et déverrouillé pendant l'installation.",
                OnShow = w => w.ShowIloaderStep()
            });
            steps.Add(new Step {
                Title = "5. Sur l'iPhone : autoriser SideStore",
                Body = "SideStore est installé, mais iOS ne l'ouvrira pas tant que tu ne l'as pas autorisé.\n\n" +
                       "A.  Faire confiance\n" +
                       "   1.  Ouvre Réglages → Général → VPN et gestion de l'appareil.\n" +
                       "   2.  Sous « App de développeur », touche ton adresse Apple.\n" +
                       "   3.  Touche « Faire confiance » (ou « Autoriser et redémarrer ») et confirme.\n\n" +
                       "B.  Activer le mode développeur\n" +
                       "   1.  Réglages → Confidentialité et sécurité → tout en bas : Mode développeur.\n" +
                       "   2.  Active-le : l'iPhone redémarre.\n" +
                       "   3.  Au redémarrage, touche « Activer » et tape ton code.\n\n" +
                       "Pas de « Mode développeur » dans les Réglages ? Il n'est pas nécessaire sur ta version d'iOS : passe à la suite."
            });
            steps.Add(new Step {
                Title = "6. Premier lancement de SideStore",
                Body = "   1.  Ouvre LocalDevVPN : il doit afficher « Connected » (sinon touche « Connect »).\n" +
                       "   2.  Ouvre SideStore.\n" +
                       "   3.  Connecte-toi avec le même identifiant Apple que dans iloader.\n" +
                       "   4.  Va dans l'onglet « Mes apps » et touche le bouton « 7 JOURS » à côté de SideStore.\n" +
                       "   5.  S'il demande de créer ou de révoquer un certificat : touche « Oui ».\n\n" +
                       "SideStore se ferme puis revient : c'est normal, il vient de se renouveler.\n\n" +
                       "Tu peux débrancher l'iPhone : la suite se fait sans câble."
            });
            steps.Add(new Step {
                Title = "7. Installer Boombox",
                Body = "Scanne ce QR code avec l'iPhone (ou va tout en bas de la page déjà ouverte).\n\n" +
                       "   1.  Vérifie que LocalDevVPN affiche « Connected ».\n" +
                       "   2.  Touche « Ajouter Boombox à SideStore », puis « Ajouter » dans SideStore.\n" +
                       "   3.  Dans SideStore, va dans « Parcourir », touche Boombox, puis « Installer ».\n\n" +
                       "Ça ne marche pas ? Sur la même page, touche « Installer Boombox directement ».",
                Qr = "qr_boombox.png",
                QrCaption = "Scanne avec l'appareil photo"
            });
            steps.Add(new Step {
                Title = "C'est fini ! 🎉",
                Body = "Ouvre Boombox sur l'iPhone, choisis « J'ai déjà Boombox sur un autre appareil » et suis les indications pour retrouver ta bibliothèque.\n\n" +
                       "Bon à savoir :\n" +
                       "   •  Avec un identifiant Apple gratuit, une appli installée dure 7 jours. SideStore la renouvelle tout seul en arrière-plan quand LocalDevVPN est connecté, et Boombox te prévient avant la fin.\n" +
                       "   •  Pour renouveler à la main : LocalDevVPN sur « Connect », puis SideStore → Mes apps → « Tout actualiser ».\n" +
                       "   •  Ne supprime pas LocalDevVPN : sans elle, SideStore ne peut plus renouveler Boombox.\n" +
                       "   •  Les mises à jour de Boombox arrivent toutes seules, dans l'appli.\n\n" +
                       "Tu peux relancer ce programme à tout moment, par exemple pour réinstaller SideStore sur un nouvel iPhone."
            });
        }

        // ---------- Fenêtre ----------
        void BuildUi()
        {
            var side = new Panel { Dock = DockStyle.Left, Width = P(250), BackColor = Side, Padding = new Padding(P(18), P(22), P(12), P(12)) };
            var brand = new Label { Text = "Boombox\nsur iPhone", Font = new Font("Segoe UI", 17f, FontStyle.Bold), ForeColor = Accent, AutoSize = false, Height = P(100), Dock = DockStyle.Top };
            var list = new Panel { Dock = DockStyle.Fill, BackColor = Side };
            sideItems = new Label[steps.Count];
            string[] names = { "Bienvenue", "LocalDevVPN", "Préparer le PC", "Brancher l'iPhone", "Installer SideStore", "Autoriser SideStore", "Lancer SideStore", "Installer Boombox", "Terminé" };
            for (int i = 0; i < steps.Count; i++)
            {
                int idx = i;
                var l = new Label { Text = names[i], AutoSize = false, Height = P(38), Width = P(220), Top = i * P(42), Left = 0, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(P(10), 0, 0, 0), Cursor = Cursors.Hand, Font = new Font("Segoe UI", 11f) };
                l.Click += (s, e) => { if (idx <= reached) Show(idx); };
                sideItems[i] = l;
                list.Controls.Add(l);
            }
            side.Controls.Add(list);
            side.Controls.Add(brand);

            var bottom = new Panel { Dock = DockStyle.Bottom, Height = P(76), BackColor = Bg, Padding = new Padding(P(28), P(14), P(28), P(18)) };
            next = MakeButton("Suivant →", true);
            next.Dock = DockStyle.Right;
            next.Width = P(170);
            next.Click += (s, e) => { if (cur == steps.Count - 1) Close(); else Show(cur + 1); };
            back = MakeButton("← Retour", false);
            back.Dock = DockStyle.Left;
            back.Width = P(130);
            back.Click += (s, e) => { if (cur > 0) Show(cur - 1); };
            var guide = new LinkLabel { Text = "Guide en version texte", AutoSize = true, LinkColor = Muted, ActiveLinkColor = Accent, Dock = DockStyle.None, Top = P(26), Left = P(170) };
            guide.LinkClicked += (s, e) => OpenTextGuide();
            bottom.Controls.Add(guide);
            bottom.Controls.Add(back);
            bottom.Controls.Add(next);

            content = new Panel { Dock = DockStyle.Fill, BackColor = Bg, Padding = new Padding(P(36), P(24), P(36), P(8)), AutoScroll = true };
            title = new Label { Font = new Font("Segoe UI", 18f, FontStyle.Bold), AutoSize = false, Height = P(48), Dock = DockStyle.Top, ForeColor = Color.White };
            qr = new PictureBox { Width = P(230), Height = P(230), SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.White, Visible = false };
            qrCaption = new Label { AutoSize = false, Width = P(230), Height = P(46), TextAlign = ContentAlignment.MiddleCenter, ForeColor = Muted, Visible = false };
            body = new Label { AutoSize = false, ForeColor = Color.FromArgb(232, 228, 240), Font = new Font("Segoe UI", 11f) };
            status = new Label { AutoSize = false, Height = P(80), ForeColor = Muted, Font = new Font("Segoe UI", 11f, FontStyle.Bold) };
            action = MakeButton("", true);
            action.Width = P(230);
            action.Visible = false;
            action2 = MakeButton("", false);
            action2.Width = P(230);
            action2.Visible = false;
            content.Controls.Add(body);
            content.Controls.Add(qr);
            content.Controls.Add(qrCaption);
            content.Controls.Add(status);
            content.Controls.Add(action);
            content.Controls.Add(action2);
            content.Controls.Add(title);
            content.Resize += (s, e) => Layout2();

            Controls.Add(content);
            Controls.Add(bottom);
            Controls.Add(side);

            poll = new System.Windows.Forms.Timer { Interval = 2000 };
        }

        Button MakeButton(string text, bool primary)
        {
            var b = new Button { Text = text, Height = P(44), FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand, Font = new Font("Segoe UI", 11f, FontStyle.Bold) };
            b.FlatAppearance.BorderSize = primary ? 0 : 2;
            b.FlatAppearance.BorderColor = Accent;
            b.BackColor = primary ? Accent : Bg;
            b.ForeColor = primary ? Color.FromArgb(18, 18, 18) : Accent;
            return b;
        }

        // Mise en page de la zone de droite (texte à gauche, QR code à droite s'il y en a un)
        void Layout2()
        {
            int w = content.ClientSize.Width - content.Padding.Left - content.Padding.Right;
            using (var g0 = CreateGraphics()) title.Height = TextRenderer.MeasureText(g0, title.Text, title.Font, new Size(w, 1000), TextFormatFlags.WordBreak).Height + P(8);
            int x = content.Padding.Left, y = title.Bottom + P(8);
            bool hasQr = qr.Visible;
            int textW = hasQr ? w - P(260) : w;
            using (var g = CreateGraphics())
            {
                var size = TextRenderer.MeasureText(g, body.Text, body.Font, new Size(textW, 10000), TextFormatFlags.WordBreak);
                body.SetBounds(x, y, textW, size.Height + P(6));
            }
            if (hasQr)
            {
                qr.SetBounds(x + w - P(230), y, P(230), P(230));
                qrCaption.SetBounds(x + w - P(230), y + P(234), P(230), P(46));
            }
            int ay = Math.Max(body.Bottom, hasQr ? qrCaption.Bottom : 0) + P(14);
            if (action.Visible) { action.SetBounds(x, ay, P(230), P(44)); }
            if (action2.Visible) { action2.SetBounds(x + P(244), ay, P(230), P(44)); }
            int sy = (action.Visible ? action.Bottom : ay - P(14)) + P(10);
            status.SetBounds(x, sy, w, P(80));
        }

        void Show(int i)
        {
            poll.Stop();
            poll.Tick -= DetectTick;
            cur = i;
            reached = Math.Max(reached, i);
            var s = steps[i];
            title.Text = s.Title;
            body.Text = s.Body;
            qr.Visible = qrCaption.Visible = s.Qr != null;
            if (s.Qr != null)
            {
                qr.Image = LoadImage(s.Qr);
                qrCaption.Text = s.QrCaption;
            }
            action.Visible = action2.Visible = false;
            action.Enabled = action2.Enabled = true;
            SetStatus("", Muted);
            back.Visible = i > 0;
            next.Text = i == steps.Count - 1 ? "Fermer" : "Suivant →";
            for (int k = 0; k < sideItems.Length; k++)
            {
                var l = sideItems[k];
                l.BackColor = k == i ? Card : Side;
                l.ForeColor = k == i ? Color.White : k <= reached ? Color.FromArgb(214, 210, 224) : Color.FromArgb(110, 106, 120);
                l.Font = new Font("Segoe UI", 11f, k == i ? FontStyle.Bold : FontStyle.Regular);
                l.Text = (k < i ? "✓  " : k == i ? "›  " : "    ") + l.Text.TrimStart('✓', '›', ' ');
            }
            if (s.OnShow != null) s.OnShow(this);
            Layout2();
        }

        void SetStatus(string text, Color c)
        {
            status.Text = text;
            status.ForeColor = c;
        }

        void SetAction(Button b, string text, Action run)
        {
            b.Text = text;
            b.Visible = true;
            b.Enabled = true;
            // Un seul gestionnaire à la fois : on remplace le bouton par un neuf à chaque étape
            var fresh = MakeButton(text, b == action);
            fresh.Width = P(230);
            fresh.Click += (s, e) => run();
            content.Controls.Remove(b);
            content.Controls.Add(fresh);
            if (b == action) action = fresh; else action2 = fresh;
            Layout2();
        }

        static Image LoadImage(string name)
        {
            var st = typeof(Wizard).Assembly.GetManifestResourceStream(name);
            return st == null ? null : Image.FromStream(st);
        }

        void Ui(Action a)
        {
            if (IsDisposed) return;
            if (InvokeRequired) { try { BeginInvoke(a); } catch { } }
            else a();
        }

        // ---------- Étape « Bienvenue » ----------
        void CheckWindows()
        {
            string arch = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432") ?? Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "").ToUpperInvariant();
            if (!Environment.Is64BitOperatingSystem) SetStatus("⚠  Ce PC a un Windows 32 bits : SideStore ne peut pas s'installer depuis ce PC. Utilise un autre ordinateur.", Warn);
            else if (arch.Contains("ARM")) SetStatus("⚠  Ce PC a un processeur ARM : l'installeur de SideStore n'y fonctionne pas. Utilise un autre ordinateur.", Warn);
            else SetStatus("✓  Ce PC est compatible.", Ok);
        }

        // ---------- Étape « Préparer le PC » ----------
        static bool HasAppleDrivers()
        {
            try
            {
                foreach (var sc in ServiceController.GetServices())
                    if (sc.ServiceName.IndexOf("Apple Mobile Device", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            }
            catch { }
            // iTunes ou « Appareils Apple » du Microsoft Store
            try
            {
                string wa = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Packages");
                if (Directory.Exists(wa))
                    foreach (var d in Directory.GetDirectories(wa, "AppleInc.*")) return true;
            }
            catch { }
            return false;
        }

        static string FindIloader()
        {
            var places = new List<string> {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "iloader", "iloader.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "iloader", "iloader.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "iloader", "iloader.exe"),
            };
            foreach (var root in new[] { Registry.LocalMachine, Registry.CurrentUser })
            {
                foreach (var key in new[] { @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" })
                {
                    try
                    {
                        using (var k = root.OpenSubKey(key))
                        {
                            if (k == null) continue;
                            foreach (var n in k.GetSubKeyNames())
                            {
                                using (var e = k.OpenSubKey(n))
                                {
                                    var name = e == null ? null : e.GetValue("DisplayName") as string;
                                    if (name == null || name.IndexOf("iloader", StringComparison.OrdinalIgnoreCase) < 0) continue;
                                    var loc = e.GetValue("InstallLocation") as string;
                                    if (!string.IsNullOrEmpty(loc)) places.Insert(0, Path.Combine(loc, "iloader.exe"));
                                }
                            }
                        }
                    }
                    catch { }
                }
            }
            foreach (var p in places) if (File.Exists(p)) return p;
            return null;
        }

        void ShowPcStep()
        {
            bool drv = HasAppleDrivers();
            bool il = FindIloader() != null;
            if (drv && il)
            {
                SetStatus("✓  iTunes (pilotes de l'iPhone) : installé\n✓  iloader : installé", Ok);
                return;
            }
            SetStatus((drv ? "✓  iTunes (pilotes de l'iPhone) : installé" : "✗  iTunes (pilotes de l'iPhone) : à installer") + "\n" + (il ? "✓  iloader : installé" : "✗  iloader : à installer"), Warn);
            SetAction(action, "Tout installer", () => InstallAll(!drv, !il));
        }

        void InstallAll(bool needDrivers, bool needIloader)
        {
            action.Enabled = false;
            next.Enabled = back.Enabled = false;
            var t = new Thread(() =>
            {
                string err = null;
                try
                {
                    ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
                    if (needIloader)
                    {
                        string msi = Path.Combine(Path.GetTempPath(), "iloader-windows-x64.msi");
                        Download(ILOADER_MSI, msi, "Téléchargement d'iloader");
                        Ui(() => SetStatus("Installation d'iloader… (réponds « Oui » si Windows demande une autorisation)", Accent));
                        Run("msiexec", "/i \"" + msi + "\" /passive /norestart", true);
                        if (FindIloader() == null) err = "iloader ne s'est pas installé. Réessaie, ou installe-le à la main depuis github.com/nab138/iloader.";
                    }
                    if (needDrivers && err == null)
                    {
                        Ui(() => SetStatus("Installation d'iTunes… (quelques minutes ; réponds « Oui » si Windows demande une autorisation)", Accent));
                        bool ok = false;
                        try
                        {
                            Run("winget", "install -e --id Apple.iTunes --silent --accept-package-agreements --accept-source-agreements", true);
                            ok = HasAppleDrivers();
                        }
                        catch { }
                        if (!ok)
                        {
                            // Sans winget : l'installeur d'Apple, à suivre en cliquant sur « Suivant »
                            string exe = Path.Combine(Path.GetTempPath(), "iTunes64Setup.exe");
                            Download(ITUNES, exe, "Téléchargement d'iTunes");
                            Ui(() => SetStatus("L'installeur d'iTunes est ouvert : clique sur « Suivant » jusqu'à la fin, puis reviens ici.", Accent));
                            Run(exe, "", true);
                        }
                        if (!HasAppleDrivers()) err = "iTunes n'a pas pu être installé. Installe-le depuis apple.com/itunes, puis clique sur « Vérifier à nouveau ».";
                    }
                }
                catch (Exception ex) { err = "Problème : " + ex.Message + "\nVérifie la connexion Internet et réessaie."; }
                Ui(() =>
                {
                    next.Enabled = back.Enabled = true;
                    if (err != null)
                    {
                        SetStatus("✗  " + err, Warn);
                        SetAction(action, "Réessayer", () => ShowPcStep());
                        SetAction(action2, "Vérifier à nouveau", () => ShowPcStep());
                    }
                    else
                    {
                        action.Visible = action2.Visible = false;
                        SetStatus("✓  Tout est installé. Clique sur « Suivant ».", Ok);
                        Layout2();
                    }
                });
            });
            t.IsBackground = true;
            t.Start();
        }

        void Download(string url, string dest, string label)
        {
            using (var wc = new WebClient())
            {
                wc.Headers.Add("User-Agent", "BoomboxInstaller");
                var done = new ManualResetEvent(false);
                Exception fail = null;
                wc.DownloadProgressChanged += (s, e) => Ui(() => SetStatus(label + "… " + e.ProgressPercentage + " %", Accent));
                wc.DownloadFileCompleted += (s, e) => { fail = e.Error; done.Set(); };
                wc.DownloadFileAsync(new Uri(url), dest);
                done.WaitOne();
                if (fail != null) throw fail;
            }
        }

        static void Run(string file, string args, bool wait)
        {
            var p = Process.Start(new ProcessStartInfo(file, args) { UseShellExecute = true, WindowStyle = ProcessWindowStyle.Normal });
            if (wait && p != null) p.WaitForExit();
        }

        // ---------- Étape « Brancher l'iPhone » ----------
        void StartDetect()
        {
            if (!HasAppleDrivers()) SetStatus("⚠  iTunes n'est pas installé : reviens à l'étape « Préparer le PC ».", Warn);
            else SetStatus("…  En attente de l'iPhone", Muted);
            poll.Tick += DetectTick;
            poll.Start();
            DetectTick(null, null);
        }

        void DetectTick(object s, EventArgs e)
        {
            var t = new Thread(() =>
            {
                string name = FindIphone();
                Ui(() =>
                {
                    if (cur != 3) return;
                    if (name != null) SetStatus("✓  " + name + " détecté. Vérifie que tu as touché « Se fier » sur l'iPhone, puis clique sur « Suivant ».", Ok);
                    else if (HasAppleDrivers()) SetStatus("…  En attente de l'iPhone (branche-le et déverrouille-le)", Muted);
                });
            });
            t.IsBackground = true;
            t.Start();
        }

        static string FindIphone()
        {
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT Name FROM Win32_PnPEntity WHERE Name LIKE '%Apple iPhone%' OR Name LIKE '%Apple iPad%' OR Name LIKE '%Apple Mobile Device USB%'"))
                {
                    foreach (ManagementObject o in q.Get())
                    {
                        string n = (o["Name"] as string) ?? "";
                        if (n.IndexOf("iPad", StringComparison.OrdinalIgnoreCase) >= 0) return "iPad";
                        return "iPhone";
                    }
                }
            }
            catch { }
            return null;
        }

        // ---------- Étape « Installer SideStore » ----------
        void ShowIloaderStep()
        {
            string il = FindIloader();
            if (il == null)
            {
                SetStatus("⚠  iloader n'est pas installé : reviens à l'étape « Préparer le PC ».", Warn);
                return;
            }
            SetAction(action, "Ouvrir iloader", () =>
            {
                try { Run(il, "", false); SetStatus("iloader est ouvert. Suis les 3 points ci-dessus, puis clique sur « Suivant » quand SideStore est installé.", Accent); }
                catch (Exception ex) { SetStatus("✗  Impossible d'ouvrir iloader : " + ex.Message, Warn); }
            });
        }

        // ---------- Guide texte ----------
        void OpenTextGuide()
        {
            try
            {
                string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "Guide Boombox iPhone.txt");
                WriteGuide(path);
                Process.Start("notepad.exe", "\"" + path + "\"");
            }
            catch (Exception ex) { MessageBox.Show("Impossible de créer le guide : " + ex.Message); }
        }

        void WriteGuide(string path)
        {
            {
                var w = new StringWriter();
                w.WriteLine("BOOMBOX SUR IPHONE : LE GUIDE");
                w.WriteLine("=============================");
                w.WriteLine();
                w.WriteLine("Page à suivre sur l'iPhone : https://musikal-b72d1.web.app/iphone.html");
                w.WriteLine();
                foreach (var s in steps)
                {
                    w.WriteLine(s.Title.Replace("👋", "").Replace("🎉", "").Trim().ToUpperInvariant());
                    w.WriteLine(new string('-', 40));
                    w.WriteLine(s.Body.Replace("Scanne le QR code avec l'appareil photo de l'iPhone.", "Sur l'iPhone, ouvre dans Safari la page https://musikal-b72d1.web.app/iphone.html (ou scanne le QR code affiché par le programme).").Replace("\n\nClique sur « Suivant » pour commencer.", "").Replace("Scanne ce QR code avec l'iPhone", "Ouvre https://musikal-b72d1.web.app/iphone.html#boombox sur l'iPhone"));
                    w.WriteLine();
                }
                File.WriteAllText(path, w.ToString(), new System.Text.UTF8Encoding(true));
            }
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var args = Environment.GetCommandLineArgs();
            if (args.Length > 2 && args[1] == "--guide") { new Wizard().WriteGuide(args[2]); return; }
            // --captures <dossier> : image de chaque étape (pour vérifier la mise en page)
            if (args.Length > 2 && args[1] == "--captures")
            {
                var f = new Wizard();
                f.Shown += (s, e) =>
                {
                    for (int i = 0; i < f.steps.Count; i++)
                    {
                        f.Show(i);
                        Application.DoEvents();
                        using (var bmp = new Bitmap(f.Width, f.Height))
                        {
                            f.DrawToBitmap(bmp, new Rectangle(0, 0, f.Width, f.Height));
                            bmp.Save(Path.Combine(args[2], "etape" + i + ".png"));
                        }
                    }
                    f.Close();
                };
                Application.Run(f);
                return;
            }
            Application.Run(new Wizard());
        }
    }
}
