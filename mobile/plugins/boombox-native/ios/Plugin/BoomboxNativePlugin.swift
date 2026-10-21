import Foundation
import UIKit
import Capacitor
import AVFoundation

// Module natif Boombox (iOS)
// - Au démarrage : session audio « lecture » pour que la musique continue écran verrouillé / en arrière-plan
// - getInfo() : version de l'appli et date d'expiration du profil de signature (installé par SideStore, 7 jours)
@objc(BoomboxNativePlugin)
public class BoomboxNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BoomboxNativePlugin"
    public let jsName = "BoomboxNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVoicePlaylists", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeVoiceCommand", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [])
        try? session.setActive(true)
        // Casque, écouteurs ou enceinte Bluetooth déconnecté : on prévient l'appli pour mettre en pause
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: raw), reason == .oldDeviceUnavailable else { return }
            self?.notifyListeners("audioUnplugged", data: [:])
        }
        // Interruption (vocal WhatsApp/Snap, appel, vidéo d'une autre appli) : début et fin transmis à l'appli,
        // qui reprend la musique quand iOS l'indique (fin d'un vocal). La session est réactivée à la fin,
        // sinon le lecteur peut continuer « en silence » (le son est coupé mais le temps avance).
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began {
                self?.notifyListeners("audioInterruption", data: ["phase": "began"])
            } else {
                let opts = AVAudioSession.InterruptionOptions(rawValue: (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0)
                try? AVAudioSession.sharedInstance().setActive(true)
                self?.notifyListeners("audioInterruption", data: ["phase": "ended", "resume": opts.contains(.shouldResume)])
            }
        }
        // Retour sur l'appli : session audio réactivée (une autre appli a pu la prendre sans la rendre)
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            try? AVAudioSession.sharedInstance().setActive(true)
            self?.notifyListeners("audioActive", data: [:])
        }
        // Commande Siri reçue pendant que l'appli tourne : transmise tout de suite au JavaScript
        NotificationCenter.default.addObserver(forName: Notification.Name("BoomboxVoice"), object: nil, queue: .main) { [weak self] note in
            guard let url = note.userInfo?["url"] as? String else { return }
            UserDefaults.standard.removeObject(forKey: "boombox.voice")
            self?.notifyListeners("voice", data: ["url": url])
        }
    }

    // Noms des playlists, pour que Siri les reconnaisse (« lance Culture G sur Boombox »)
    @objc func setVoicePlaylists(_ call: CAPPluginCall) {
        let names = (call.getArray("names") as? [String]) ?? []
        UserDefaults.standard.set(Array(names.prefix(200)), forKey: "boombox.playlists")
        if #available(iOS 16.0, *) { BoomboxNativePlugin.refreshSiri() }
        call.resolve()
    }

    // Commande Siri arrivée avant que le JavaScript soit prêt (appli lancée par Siri)
    @objc func takeVoiceCommand(_ call: CAPPluginCall) {
        let d = UserDefaults.standard
        let url = d.string(forKey: "boombox.voice")
        let at = d.double(forKey: "boombox.voiceAt")
        d.removeObject(forKey: "boombox.voice")
        if let url = url, Date().timeIntervalSince1970 - at < 120 { call.resolve(["url": url]) } else { call.resolve([:]) }
    }

    @available(iOS 16.0, *)
    static func refreshSiri() {
        // Les phrases avec un nom de playlist se mettent à jour quand la liste change
        if let cls = NSClassFromString("App.BoomboxShortcuts") as? NSObject.Type { _ = cls }
        NotificationCenter.default.post(name: Notification.Name("BoomboxRefreshShortcuts"), object: nil)
    }

    @objc func getInfo(_ call: CAPPluginCall) {
        var result: [String: Any] = [
            "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "build": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
        ]
        if let expiration = BoomboxNativePlugin.profileExpiration() {
            result["expiration"] = ISO8601DateFormatter().string(from: expiration)
        }
        call.resolve(result)
    }

    // Le fichier embedded.mobileprovision contient une liste de propriétés (XML) entourée d'une signature
    static func profileExpiration() -> Date? {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .isoLatin1),
              let start = text.range(of: "<?xml"),
              let end = text.range(of: "</plist>") else { return nil }
        let plistText = String(text[start.lowerBound..<end.upperBound])
        guard let plistData = plistText.data(using: .isoLatin1),
              let plist = try? PropertyListSerialization.propertyList(from: plistData, options: [], format: nil) as? [String: Any] else { return nil }
        return plist["ExpirationDate"] as? Date
    }
}