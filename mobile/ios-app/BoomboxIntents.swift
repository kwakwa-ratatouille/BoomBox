// Commandes Siri natives de Boombox (App Intents, iOS 16+). Ajouté à l'appli iPhone par la compilation GitHub.
// « Dis Siri, mets Ninho sur Boombox » · « Dis Siri, mets Culture G sur Boombox » · « Dis Siri, mets Jefe sur Boombox »
// « Dis Siri, cherche sur Boombox » (Siri demande quoi) · « Dis Siri, lance une jam sur Boombox »
// « Dis Siri, pause / suivant / précédent sur Boombox »
// L'appli s'ouvre et exécute la commande (lien boombox:// transmis au JavaScript par le module natif).
import AppIntents
import Foundation

// Transmission à l'appli : gardé dans les réglages + notification (si l'appli tourne déjà)
enum BoomboxVoice {
    static func send(_ url: String) {
        UserDefaults.standard.set(url, forKey: "boombox.voice")
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "boombox.voiceAt")
        NotificationCenter.default.post(name: Notification.Name("BoomboxVoice"), object: nil, userInfo: ["url": url])
    }
    static func enc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }
    static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR"))
    }
}

// Listes changées (playlists, artistes, sons) : Siri apprend les nouveaux noms
@available(iOS 16.0, *)
final class BoomboxShortcutsRefresher {
    static let shared = BoomboxShortcutsRefresher()
    private var token: NSObjectProtocol?
    func start() {
        guard token == nil else { return }
        token = NotificationCenter.default.addObserver(forName: Notification.Name("BoomboxRefreshShortcuts"), object: nil, queue: .main) { _ in
            BoomboxShortcuts.updateAppShortcutParameters()
        }
        BoomboxShortcuts.updateAppShortcutParameters()
    }
}

// Ce qu'on peut lancer par la voix : une playlist, un artiste suivi / beaucoup écouté, ou un son liké / récent.
// id = « p:nom », « a:nom » ou « s:titre|artiste » (listes envoyées par l'appli à chaque changement)
@available(iOS 16.0, *)
struct BoomboxItem: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Musique"
    static var defaultQuery = BoomboxItemQuery()
    var id: String
    var name: String
    var kind: String { String(id.prefix(1)) }
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: kind == "p" ? "Playlist" : kind == "a" ? "Artiste" : "Titre")
    }
}

@available(iOS 16.0, *)
struct BoomboxItemQuery: EntityStringQuery {
    static func all() -> [BoomboxItem] {
        let d = UserDefaults.standard
        let pl = (["Titres likés"] + (d.stringArray(forKey: "boombox.playlists") ?? [])).map { BoomboxItem(id: "p:\($0)", name: $0) }
        let ar = (d.stringArray(forKey: "boombox.artists") ?? []).map { BoomboxItem(id: "a:\($0)", name: $0) }
        let so = (d.stringArray(forKey: "boombox.songs") ?? []).map { s -> BoomboxItem in
            BoomboxItem(id: "s:\(s)", name: String(s.split(separator: "|", maxSplits: 1).first ?? Substring(s)))
        }
        // Playlists d'abord, puis artistes, puis sons : en cas de nom identique, c'est la playlist qui gagne
        var seen = Set<String>()
        return (pl + ar + so).filter { seen.insert(BoomboxVoice.fold($0.name)).inserted }
    }
    func entities(for identifiers: [String]) async throws -> [BoomboxItem] {
        let all = Self.all()
        return identifiers.compactMap { id in all.first { $0.id == id } ?? (id.count > 2 ? BoomboxItem(id: id, name: String(id.dropFirst(2))) : nil) }
    }
    func entities(matching string: String) async throws -> [BoomboxItem] {
        let q = BoomboxVoice.fold(string)
        let all = Self.all()
        let exact = all.filter { BoomboxVoice.fold($0.name) == q }
        if !exact.isEmpty { return exact }
        let hits = all.filter { BoomboxVoice.fold($0.name).contains(q) || q.contains(BoomboxVoice.fold($0.name)) }
        // Rien de connu : on cherche quand même ce qui a été dit
        return hits.isEmpty ? [BoomboxItem(id: "q:\(string)", name: string)] : hits
    }
    func suggestedEntities() async throws -> [BoomboxItem] { Self.all() }
}

@available(iOS 16.0, *)
struct PlayItemIntent: AppIntent {
    static var title: LocalizedStringResource = "Mettre un son, un artiste ou une playlist"
    static var description = IntentDescription("Lance un son, un artiste ou une de tes playlists dans Boombox.")
    static var openAppWhenRun: Bool = true
    @Parameter(title: "Quoi", requestValueDialog: "Qu’est-ce que je mets ?") var item: BoomboxItem
    func perform() async throws -> some IntentResult {
        let rest = String(item.id.dropFirst(2))
        switch item.kind {
        case "p": BoomboxVoice.send("boombox://playlist?name=\(BoomboxVoice.enc(rest))")
        case "a": BoomboxVoice.send("boombox://artist?name=\(BoomboxVoice.enc(rest))")
        default: BoomboxVoice.send("boombox://play?q=\(BoomboxVoice.enc(rest.replacingOccurrences(of: "|", with: " ")))")
        }
        return .result()
    }
}

// Recherche libre : n'importe quel son, même jamais écouté (Siri demande quoi chercher)
@available(iOS 16.0, *)
struct SearchPlayIntent: AppIntent {
    static var title: LocalizedStringResource = "Chercher et mettre un son"
    static var description = IntentDescription("Cherche un son ou un artiste et le lance dans Boombox.")
    static var openAppWhenRun: Bool = true
    @Parameter(title: "Recherche", requestValueDialog: "Qu’est-ce que je cherche ?") var query: String
    func perform() async throws -> some IntentResult {
        BoomboxVoice.send("boombox://play?q=\(BoomboxVoice.enc(query))")
        return .result()
    }
}

@available(iOS 16.0, *)
struct StartPartyIntent: AppIntent {
    static var title: LocalizedStringResource = "Lancer une jam"
    static var description = IntentDescription("Lance une jam (écoute à plusieurs) dans Boombox.")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult {
        BoomboxVoice.send("boombox://jam")
        return .result()
    }
}

@available(iOS 16.0, *)
struct PlayBoomboxIntent: AppIntent {
    static var title: LocalizedStringResource = "Reprendre la musique"
    static var description = IntentDescription("Reprend la lecture dans Boombox.")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult {
        BoomboxVoice.send("boombox://control?a=play")
        return .result()
    }
}

@available(iOS 16.0, *)
struct PauseIntent: AppIntent {
    static var title: LocalizedStringResource = "Pause"
    static var openAppWhenRun: Bool = false
    func perform() async throws -> some IntentResult {
        BoomboxVoice.send("boombox://control?a=pause")
        return .result()
    }
}

@available(iOS 16.0, *)
struct NextIntent: AppIntent {
    static var title: LocalizedStringResource = "Son suivant"
    static var openAppWhenRun: Bool = false
    func perform() async throws -> some IntentResult {
        BoomboxVoice.send("boombox://control?a=next")
        return .result()
    }
}

@available(iOS 16.0, *)
struct PrevIntent: AppIntent {
    static var title: LocalizedStringResource = "Son précédent"
    static var openAppWhenRun: Bool = false
    func perform() async throws -> some IntentResult {
        BoomboxVoice.send("boombox://control?a=prev")
        return .result()
    }
}

// Phrases reconnues par Siri sans rien configurer (le nom de l'appli doit être dans la phrase)
@available(iOS 16.0, *)
struct BoomboxShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: PlayItemIntent(), phrases: [
            "Mets \(\.$item) sur \(.applicationName)",
            "Mets \(\.$item) avec \(.applicationName)",
            "Lance \(\.$item) sur \(.applicationName)",
            "Joue \(\.$item) sur \(.applicationName)",
            "\(.applicationName) \(\.$item)",
            "Mets un son sur \(.applicationName)",
        ], shortTitle: "Mettre", systemImageName: "music.note")
        AppShortcut(intent: SearchPlayIntent(), phrases: [
            "Cherche sur \(.applicationName)",
            "Cherche un son sur \(.applicationName)",
            "Trouve un son sur \(.applicationName)",
        ], shortTitle: "Chercher", systemImageName: "magnifyingglass")
        AppShortcut(intent: StartPartyIntent(), phrases: [
            "Lance une jam sur \(.applicationName)",
            "Lance une party sur \(.applicationName)",
            "Jam \(.applicationName)",
        ], shortTitle: "Jam", systemImageName: "person.3")
        AppShortcut(intent: PlayBoomboxIntent(), phrases: [
            "Mets \(.applicationName)",
            "Lance \(.applicationName)",
            "Reprends \(.applicationName)",
        ], shortTitle: "Reprendre", systemImageName: "play.circle")
        AppShortcut(intent: PauseIntent(), phrases: [
            "Pause \(.applicationName)",
            "Mets \(.applicationName) en pause",
            "Arrête \(.applicationName)",
        ], shortTitle: "Pause", systemImageName: "pause.circle")
        AppShortcut(intent: NextIntent(), phrases: [
            "Suivant sur \(.applicationName)",
            "Son suivant sur \(.applicationName)",
            "\(.applicationName) suivant",
        ], shortTitle: "Suivant", systemImageName: "forward.end")
        AppShortcut(intent: PrevIntent(), phrases: [
            "Précédent sur \(.applicationName)",
            "Son précédent sur \(.applicationName)",
            "\(.applicationName) précédent",
        ], shortTitle: "Précédent", systemImageName: "backward.end")
    }
}
