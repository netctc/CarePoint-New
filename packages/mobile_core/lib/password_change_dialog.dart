import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

Future<bool> showCarePointPasswordChangeDialog(
  BuildContext context, {
  required CarePointSession session,
  required CarePointLocale locale,
}) async {
  final current = TextEditingController();
  final next = TextEditingController();
  final confirm = TextEditingController();
  var busy = false;
  String? error;
  var showCurrent = false;
  var showNext = false;

  final changed = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: Text(_passwordText(locale, 'title')),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(_passwordText(locale, 'hint')),
              const SizedBox(height: 14),
              TextField(
                controller: current,
                obscureText: !showCurrent,
                autofillHints: const [AutofillHints.password],
                decoration: InputDecoration(
                  labelText: _passwordText(locale, 'current'),
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    onPressed: () => setState(() => showCurrent = !showCurrent),
                    icon: Icon(showCurrent ? Icons.visibility_off : Icons.visibility),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: next,
                obscureText: !showNext,
                autofillHints: const [AutofillHints.newPassword],
                decoration: InputDecoration(
                  labelText: _passwordText(locale, 'new'),
                  helperText: _passwordText(locale, 'policy'),
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    onPressed: () => setState(() => showNext = !showNext),
                    icon: Icon(showNext ? Icons.visibility_off : Icons.visibility),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: confirm,
                obscureText: !showNext,
                autofillHints: const [AutofillHints.newPassword],
                decoration: InputDecoration(
                  labelText: _passwordText(locale, 'confirm'),
                  border: const OutlineInputBorder(),
                ),
              ),
              if (error != null) ...[
                const SizedBox(height: 12),
                Text(
                  error!,
                  style: const TextStyle(
                    color: Color(0xFFDC2626),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: busy ? null : () => Navigator.pop(dialogContext, false),
            child: Text(_passwordText(locale, 'cancel')),
          ),
          FilledButton.icon(
            onPressed: busy
                ? null
                : () async {
                    final currentValue = current.text;
                    final nextValue = next.text;
                    final confirmValue = confirm.text;
                    if (nextValue.length < 12 || nextValue.length > 128) {
                      setState(() => error = _passwordText(locale, 'policy'));
                      return;
                    }
                    if (nextValue != confirmValue) {
                      setState(() => error = _passwordText(locale, 'mismatch'));
                      return;
                    }
                    if (currentValue.isEmpty) {
                      setState(() => error = _passwordText(locale, 'currentRequired'));
                      return;
                    }
                    setState(() {
                      busy = true;
                      error = null;
                    });
                    try {
                      await session.api.changeOwnPassword(
                        currentPassword: currentValue,
                        newPassword: nextValue,
                      );
                      if (dialogContext.mounted) {
                        Navigator.pop(dialogContext, true);
                      }
                    } catch (value) {
                      setState(() {
                        busy = false;
                        error = value.toString();
                      });
                    }
                  },
            icon: busy
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.password_rounded),
            label: Text(_passwordText(locale, 'save')),
          ),
        ],
      ),
    ),
  );

  current.dispose();
  next.dispose();
  confirm.dispose();
  return changed == true;
}

String passwordChangeLabel(CarePointLocale locale) =>
    _passwordText(locale, 'button');

String passwordChangedReauthLabel(CarePointLocale locale) =>
    _passwordText(locale, 'reauth');

String _passwordText(CarePointLocale locale, String key) {
  const values = <String, Map<String, String>>{
    'title': {
      'en': 'Change password',
      'ar': 'تغيير كلمة المرور',
      'fr': 'Changer le mot de passe',
      'es': 'Cambiar contraseña',
    },
    'button': {
      'en': 'Change password',
      'ar': 'تغيير كلمة المرور',
      'fr': 'Changer le mot de passe',
      'es': 'Cambiar contraseña',
    },
    'hint': {
      'en': 'Enter your current password and choose a new one. All CarePoint sessions will be signed out after the change.',
      'ar': 'أدخل كلمة المرور الحالية واختر كلمة مرور جديدة. سيتم تسجيل الخروج من جميع جلسات CarePoint بعد التغيير.',
      'fr': 'Saisissez votre mot de passe actuel et choisissez-en un nouveau. Toutes les sessions CarePoint seront déconnectées après le changement.',
      'es': 'Introduce tu contraseña actual y elige una nueva. Todas las sesiones de CarePoint se cerrarán después del cambio.',
    },
    'current': {
      'en': 'Current password',
      'ar': 'كلمة المرور الحالية',
      'fr': 'Mot de passe actuel',
      'es': 'Contraseña actual',
    },
    'new': {
      'en': 'New password',
      'ar': 'كلمة المرور الجديدة',
      'fr': 'Nouveau mot de passe',
      'es': 'Nueva contraseña',
    },
    'confirm': {
      'en': 'Confirm new password',
      'ar': 'تأكيد كلمة المرور الجديدة',
      'fr': 'Confirmer le nouveau mot de passe',
      'es': 'Confirmar nueva contraseña',
    },
    'policy': {
      'en': 'Use 12–128 characters and do not reuse the current password.',
      'ar': 'استخدم من 12 إلى 128 حرفاً ولا تعِد استخدام كلمة المرور الحالية.',
      'fr': 'Utilisez 12 à 128 caractères et ne réutilisez pas le mot de passe actuel.',
      'es': 'Usa entre 12 y 128 caracteres y no reutilices la contraseña actual.',
    },
    'mismatch': {
      'en': 'The new passwords do not match.',
      'ar': 'كلمتا المرور الجديدتان غير متطابقتين.',
      'fr': 'Les nouveaux mots de passe ne correspondent pas.',
      'es': 'Las nuevas contraseñas no coinciden.',
    },
    'currentRequired': {
      'en': 'Current password is required.',
      'ar': 'كلمة المرور الحالية مطلوبة.',
      'fr': 'Le mot de passe actuel est requis.',
      'es': 'La contraseña actual es obligatoria.',
    },
    'save': {
      'en': 'Change password',
      'ar': 'تغيير كلمة المرور',
      'fr': 'Changer le mot de passe',
      'es': 'Cambiar contraseña',
    },
    'cancel': {
      'en': 'Cancel',
      'ar': 'إلغاء',
      'fr': 'Annuler',
      'es': 'Cancelar',
    },
    'reauth': {
      'en': 'Password changed. Sign in again.',
      'ar': 'تم تغيير كلمة المرور. سجّل الدخول مرة أخرى.',
      'fr': 'Mot de passe modifié. Reconnectez-vous.',
      'es': 'Contraseña cambiada. Inicia sesión de nuevo.',
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
