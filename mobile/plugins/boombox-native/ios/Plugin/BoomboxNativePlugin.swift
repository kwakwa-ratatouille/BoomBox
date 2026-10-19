import Foundation
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
        CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [])
        try? session.setActive(true)
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