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
        CAPPluginMethod(name: "takeVoiceCommand", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAudioMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppIcon", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        // La page de l'appli continue de tourner en arrière-plan (sinon iOS l'endort : musique en pause au
        // verrouillage ou en ouvrant une autre appli, écoutes non comptées)
        DispatchQueue.main.async { [weak self] in
            if #available(iOS 17.0, *) {
                self?.bridge?.webView?.configuration.preferences.inactiveSchedulingPolicy = .none
            }
        }
        // Casque, écouteurs ou enceinte Bluetooth déconnecté : on prévient l'appli pour mettre en pause ;
        // reconnecté : l'appli reprend si la coupure était courte
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
            if reason == .oldDeviceUnavailable { self?.notifyListeners("audioUnplugged", data: [:]) }
            if reason == .newDeviceAvailable { self?.notifyListeners("audioPlugged", data: [:]) }
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
                if opts.contains(.shouldResume) { try? AVAudioSession.sharedInstance().setActive(true) }
                self?.notifyListeners("audioInterruption", data: ["phase": "ended", "resume": opts.contains(.shouldResume)])
            }
        }
        // Retour sur l'appli : session audio réactivée (une autre appli a pu la prendre sans la rendre)
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("audioActive", data: [:])
        }
        // Commande Siri reçue pendant que l'appli tourne : transmise tout de suite au JavaScript
        NotificationCenter.default.addObserver(forName: Notification.Name("BoomboxVoice"), object: nil, queue: .main) { [weak self] note in
            guard let url = note.userInfo?["url"] as? String else { return }
            UserDefaults.standard.removeObject(forKey: "boombox.voice")
            self?.notifyListeners("voice", data: ["url": url])
        }
    }

    // Écran gardé allumé (paroles affichées pendant la lecture)
    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }

    // mix = true : Boombox cohabite avec les autres sons ; false : lecture normale (commandes écran verrouillé)
    @objc func setAudioMode(_ call: CAPPluginCall) {
        let mix = call.getBool("mix") ?? false
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: mix ? [.mixWithOthers] : [])
        if !mix { try? session.setActive(true) }
        call.resolve()
    }

    // Noms des playlists, pour que Siri les reconnaisse (« lance Culture G sur Boombox »)
    @objc func setVoicePlaylists(_ call: CAPPluginCall) {
        let names = (call.getArray("names") as? [String]) ?? []
        UserDefaults.standard.set(Array(names.prefix(200)), forKey: "boombox.playlists")
        // Artistes et sons connus : « mets Ninho sur Boombox », « mets Jefe sur Boombox » (titre|artiste)
        if let artists = call.getArray("artists") as? [String] { UserDefaults.standard.set(Array(artists.prefix(250)), forKey: "boombox.artists") }
        if let songs = call.getArray("songs") as? [String] { UserDefaults.standard.set(Array(songs.prefix(400)), forKey: "boombox.songs") }
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

    // Icône de l'écran d'accueil selon l'événement (Halloween, Noël…) ; name vide = icône habituelle.
    // iOS affiche un petit message « Vous avez changé l'icône » à chaque changement (impossible à éviter).
    @objc func setAppIcon(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? ""
        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else { return call.reject("non pris en charge") }
            let wanted: String? = name.isEmpty ? nil : name
            if UIApplication.shared.alternateIconName == wanted { return call.resolve() }
            UIApplication.shared.setAlternateIconName(wanted) { err in
                if let err = err { call.reject(err.localizedDescription) } else { call.resolve() }
            }
        }
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