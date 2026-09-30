import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';

import 'carepoint_localization.dart';
import 'mfa_qr_clipboard_stub.dart'
    if (dart.library.html) 'mfa_qr_clipboard_web.dart';

class CarePointMfaSetupPanel extends StatelessWidget {
  const CarePointMfaSetupPanel({
    super.key,
    required this.locale,
    required this.secret,
    required this.otpauthUri,
  });

  final CarePointLocale locale;
  final String secret;
  final String otpauthUri;

  Future<void> _copySecret(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: secret));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(_text(locale, 'secretCopied'))),
    );
  }

  Future<void> _copyQr(BuildContext context) async {
    try {
      final painter = QrPainter(
        data: otpauthUri,
        version: QrVersions.auto,
        gapless: true,
        errorCorrectionLevel: QrErrorCorrectLevel.M,
      );
      final data = await painter.toImageData(
        512,
        format: ui.ImageByteFormat.png,
      );
      final bytes = data?.buffer.asUint8List();
      final copied = bytes != null && await copyPngBytesToClipboard(bytes);
      if (!context.mounted) return;
      if (copied) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_text(locale, 'qrCopied'))),
        );
        return;
      }
      await Clipboard.setData(ClipboardData(text: otpauthUri));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_text(locale, 'qrFallback'))),
      );
    } catch (_) {
      await Clipboard.setData(ClipboardData(text: otpauthUri));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_text(locale, 'qrFallback'))),
      );
    }
  }

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(_text(locale, 'hint')),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Text(
                  _text(locale, 'qrTitle'),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
              IconButton(
                tooltip: _text(locale, 'copyQr'),
                onPressed: () => _copyQr(context),
                icon: const Icon(Icons.copy_all_rounded),
              ),
            ],
          ),
          Center(
            child: Container(
              color: Colors.white,
              padding: const EdgeInsets.all(10),
              child: QrImageView(
                data: otpauthUri,
                size: 190,
                backgroundColor: Colors.white,
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            _text(locale, 'secretTitle'),
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 5),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: SelectableText(
                  secret,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.1,
                  ),
                ),
              ),
              IconButton(
                tooltip: _text(locale, 'copySecret'),
                onPressed: () => _copySecret(context),
                icon: const Icon(Icons.content_copy_rounded),
              ),
            ],
          ),
        ],
      );
}

String _text(CarePointLocale locale, String key) {
  const values = <String, Map<String, String>>{
    'hint': {
      'en': 'Scan the QR code with your authenticator app, or enter the Secret Code manually. Then enter the current 6-digit code below.',
      'ar': 'امسح رمز QR بتطبيق المصادقة أو أدخل الرمز السري يدوياً، ثم أدخل رمز التحقق الحالي المكوّن من 6 أرقام.',
      'fr': 'Scannez le QR avec votre application d’authentification ou saisissez le code secret manuellement, puis entrez le code actuel à 6 chiffres.',
      'es': 'Escanea el QR con tu aplicación autenticadora o introduce manualmente el Secret Code y después escribe el código actual de 6 dígitos.',
    },
    'qrTitle': {'en':'Authenticator QR code','ar':'رمز QR للمصادقة','fr':'QR de l’authentificateur','es':'Código QR del autenticador'},
    'copyQr': {'en':'Copy QR image','ar':'نسخ صورة QR','fr':'Copier l’image QR','es':'Copiar imagen QR'},
    'secretTitle': {'en':'Secret Code','ar':'الرمز السري','fr':'Code secret','es':'Secret Code'},
    'copySecret': {'en':'Copy Secret Code','ar':'نسخ الرمز السري','fr':'Copier le code secret','es':'Copiar Secret Code'},
    'secretCopied': {'en':'Secret Code copied.','ar':'تم نسخ الرمز السري.','fr':'Code secret copié.','es':'Secret Code copiado.'},
    'qrCopied': {'en':'QR image copied.','ar':'تم نسخ صورة QR.','fr':'Image QR copiée.','es':'Imagen QR copiada.'},
    'qrFallback': {
      'en':'This device/browser cannot copy PNG images directly. The authenticator URI was copied instead.',
      'ar':'لا يدعم هذا الجهاز أو المتصفح نسخ صورة PNG مباشرة. تم نسخ رابط المصادقة بدلاً منها.',
      'fr':'Ce navigateur/appareil ne peut pas copier directement l’image PNG. L’URI d’authentification a été copié à la place.',
      'es':'Este navegador/dispositivo no puede copiar directamente la imagen PNG. Se copió el URI del autenticador como alternativa.',
    },
  };
  final language = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  return values[key]?[language] ?? values[key]?['en'] ?? key;
}
