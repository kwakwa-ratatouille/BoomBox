// Commandes Siri natives de Boombox (App Intents, iOS 16+). Ajouté à l'appli iPhone par la compilation GitHub.
// « Dis Siri, lance Culture G sur Boombox » · « Dis Siri, lance une party sur Boombox » · « Dis Siri, mets Boombox »
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
}

// Liste des playlists changée : Siri apprend les nouveaux noms
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

// Une playlist de la bibliothèque (liste envoyée par l'appli à chaque changement)
@available(iOS 16.0, *)
struct BoomboxPlaylist: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Playlist"
    static var defaultQuery = BoomboxPlaylistQuery()
    var id: String
    var name: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

@available(iOS 16.0, *)
struct BoomboxPlaylistQuery: EntityStringQuery {
    static func all() -> [BoomboxPlaylist] {
        let names = UserDefaults.standard.stringArray(forKey: "boombox.playlists") ?? []
        return (["Titres likés"] + names).map { BoomboxPlaylist(id: $0, name: $0) }
    }
    func entities(for identifiers: [String]) async throws -> [BoomboxPlaylist] {
        Self.all().filter { identifiers.contains($0.id) }
    }
    func entities(matching string: String) async throws -> [BoomboxPlaylist] {
        let q = string.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
        return Self.all().filter { $0.name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current).contains(q) }
    }
    func suggestedEntities() async throws -> [BoomboxPlaylist] { Self.all() }
}

@available(iOS 16.0, *)
struct PlayPlaylistIntent: AppIntent {
    static var title: LocalizedStringResource = "Lancer une playlist"
    static var description = IntentDescription("Lance une de tes playlists dans Boombox.")
    static var openAppWhenRun: Bool = true
    @Parameter(title: "Playlist") var playlist: BoomboxPlaylist
    func perform() async throws -> some IntentResult {
        BoomboxVoice.send("boombox://playlist?name=\(BoomboxVoice.enc(playlist.name))")
        return .result()
    }
}

@available(iOS 16.0, *)
struct StartPartyIntent: AppIntent {
    static var title: LocalizedStringResource = "Lancer une party"
    static var description = IntentDescription("Lance le mode party de Boombox.")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult {
        BoomboxVoice.send("boombox://jam")
        return .result()
    }
}

@available(iOS 16.0, *)
struct PlayBoomboxIntent: AppIntent {
    static var title: LocalizedStringResource = "Mettre de la musique"
    static var description = IntentDescription("Reprend la lecture dans Boombox.")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult {
        BoomboxVoice.send("boombox://control?a=play")
        return .result()
    }
}

// Phrases reconnues par Siri sans rien configurer (le nom de l'appli doit être dans la phrase)
@available(iOS 16.0, *)
struct BoomboxShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: PlayPlaylistIntent(), phrases: [
            "Lance \(\.$playlist) sur \(.applicationName)",
            "Mets \(\.$playlist) sur \(.applicationName)",
            "Joue \(\.$playlist) sur \(.applicationName)",
            "Lance la playlist \(\.$playlist) sur \(.applicationName)",
            "Lance une playlist sur \(.applicationName)",
        ], shortTitle: "Playlist", systemImageName: "music.note.list")
        AppShortcut(intent: StartPartyIntent(), phrases: [
            "Lance une party sur \(.applicationName)",
            "Lance une jam sur \(.applicationName)",
            "Mode party sur \(.applicationName)",
        ], shortTitle: "Party", systemImageName: "person.3")
        AppShortcut(intent: PlayBoomboxIntent(), phrases: [
            "Mets \(.applicationName)",
            "Lance \(.applicationName)",
            "Mets de la musique sur \(.applicationName)",
        ], shortTitle: "Musique", systemImageName: "play.circle")
    }
}
