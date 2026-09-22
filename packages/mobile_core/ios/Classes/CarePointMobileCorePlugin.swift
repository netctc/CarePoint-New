import Flutter
import UIKit

public final class CarePointMobileCorePlugin: NSObject, FlutterPlugin, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
  private var pendingResult: FlutterResult?

  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(name: "carepoint/mobile/photo_picker", binaryMessenger: registrar.messenger())
    let instance = CarePointMobileCorePlugin()
    registrar.addMethodCallDelegate(instance, channel: channel)
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard call.method == "pickPhoto" else {
      result(FlutterMethodNotImplemented)
      return
    }
    guard pendingResult == nil else {
      result(FlutterError(code: "PHOTO_PICKER_BUSY", message: "A photo selection is already in progress.", details: nil))
      return
    }
    guard let arguments = call.arguments as? [String: Any],
          let source = arguments["source"] as? String else {
      result(FlutterError(code: "INVALID_SOURCE", message: "Photo source must be camera or gallery.", details: nil))
      return
    }
    let sourceType: UIImagePickerController.SourceType
    switch source {
    case "camera":
      sourceType = .camera
    case "gallery":
      sourceType = .photoLibrary
    default:
      result(FlutterError(code: "INVALID_SOURCE", message: "Photo source must be camera or gallery.", details: nil))
      return
    }
    guard UIImagePickerController.isSourceTypeAvailable(sourceType) else {
      result(FlutterError(code: "SOURCE_UNAVAILABLE", message: "The requested photo source is not available on this device.", details: nil))
      return
    }
    guard let presenter = topViewController() else {
      result(FlutterError(code: "NO_VIEW_CONTROLLER", message: "Photo picker requires an active view controller.", details: nil))
      return
    }

    pendingResult = result
    let picker = UIImagePickerController()
    picker.delegate = self
    picker.sourceType = sourceType
    picker.allowsEditing = false
    picker.modalPresentationStyle = .fullScreen
    presenter.present(picker, animated: true)
  }

  public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    let result = pendingResult
    pendingResult = nil
    picker.dismiss(animated: true) {
      result?(nil)
    }
  }

  public func imagePickerController(
    _ picker: UIImagePickerController,
    didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
  ) {
    let result = pendingResult
    pendingResult = nil
    guard let image = info[.originalImage] as? UIImage,
          let bytes = image.jpegData(compressionQuality: 0.88) else {
      picker.dismiss(animated: true) {
        result?(FlutterError(code: "PHOTO_READ_FAILED", message: "The selected photo could not be encoded.", details: nil))
      }
      return
    }
    let payload: [String: Any] = [
      "bytes": FlutterStandardTypedData(bytes: bytes),
      "capturedAt": ISO8601DateFormatter().string(from: Date()),
    ]
    picker.dismiss(animated: true) {
      result?(payload)
    }
  }

  private func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let root = scenes
      .flatMap { $0.windows }
      .first(where: { $0.isKeyWindow })?
      .rootViewController
    var current = root
    while let presented = current?.presentedViewController {
      current = presented
    }
    return current
  }
}
