import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'mfa_enrollment_api.dart';

typedef CarePointAuthenticatedBuilder = Widget Function(BuildContext context, CarePointSession session, VoidCallback signOut);

class CarePointLoginGate extends StatefulWidget {
  const CarePointLoginGate({
    super.key,
    required this.locale,
    required this.expectedRole,
    required this.title,
    required this.builder,
    this.api,
    this.accent = const Color(0xFF0EA5E9),
    this.dark = false,
  });

  final CarePointLocale locale;
  final String expectedRole;
  final String title;
  final CarePointAuthenticatedBuilder builder;
  final CarePointApi? api;
  final Color accent;
  final bool dark;

  @override
  State<CarePointLoginGate> createState() => _CarePointLoginGateState();
}

class _CarePointLoginGateState extends State<CarePointLoginGate> {
  late final CarePointApi api;
  final email = TextEditingController();
  final password = TextEditingController();
  final mfa = TextEditingController();
  CarePointSession? session;
  String? challengeId;
  String? enrollmentSecret;
  String? error;
  bool busy = false;
  bool restoring = true;

  @override
  void initState() {
    super.initState();
    api = widget.api ?? CarePointApi();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    try {
      final restored = await api.restoreSession();
      if (restored != null && restored.role == widget.expectedRole) {
        if (mounted) setState(() => session = restored);
      } else if (restored != null) {
        await api.logout();
      }
    } catch (_) {
      await api.logout();
    } finally {
      if (mounted) setState(() => restoring = false);
    }
  }

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    mfa.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    setState(() { busy = true; error = null; });
    try {
      final next = challengeId == null ? await api.login(email.text, password.text) : await api.completeMfa(challengeId!, mfa.text);
      if (next.role != widget.expectedRole) {
        await api.logout();
        throw CarePointApiException('This account belongs to ${next.role}, not ${widget.expectedRole}.');
      }
      if (mounted) setState(() { session = next; challengeId = null; enrollmentSecret = null; });
    } on CarePointMfaRequired catch (value) {
      String? setupSecret;
      if (value.challengeId.startsWith('mfaenroll_')) {
        try {
          final setup = await api.beginRequiredMfaEnrollment(value.challengeId);
          setupSecret = setup['secret'];
        } catch (setupError) {
          if (mounted) setState(() => error = setupError.toString());
        }
      }
      if (mounted) {
        setState(() {
          challengeId = value.challengeId;
          enrollmentSecret = setupSecret;
          password.clear();
          mfa.clear();
        });
      }
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> signOut() async {
    await api.signOutCurrentSession();
    if (mounted) setState(() { session = null; challengeId = null; enrollmentSecret = null; mfa.clear(); });
  }

  void resetChallenge() {
    setState(() {
      challengeId = null;
      enrollmentSecret = null;
      error = null;
      mfa.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    if (restoring) {
      return Scaffold(
        backgroundColor: widget.dark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
        body: const SafeArea(child: Center(child: CircularProgressIndicator())),
      );
    }
    if (session != null) return widget.builder(context, session!, signOut);
    final locale = widget.locale;
    final enrollment = enrollmentSecret != null;
    return Scaffold(
      backgroundColor: widget.dark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Card(
                color: widget.dark ? const Color(0xFF172033) : Colors.white,
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    CircleAvatar(radius: 28, backgroundColor: widget.accent, child: const Text('C+', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900))),
                    const SizedBox(height: 16),
                    Text(widget.title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 6),
                    Text(cpText(locale, 'auth.liveApi'), textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF64748B))),
                    const SizedBox(height: 24),
                    if (challengeId == null) ...[
                      TextField(controller: email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email], decoration: InputDecoration(labelText: cpText(locale, 'auth.email'), border: const OutlineInputBorder())),
                      const SizedBox(height: 12),
                      TextField(controller: password, obscureText: true, autofillHints: const [AutofillHints.password], onSubmitted: (_) => submit(), decoration: InputDecoration(labelText: cpText(locale, 'auth.password'), border: const OutlineInputBorder())),
                    ] else ...[
                      Text(enrollment ? _enrollmentPrompt(locale) : cpText(locale, 'auth.mfaPrompt')),
                      if (enrollment) ...[
                        const SizedBox(height: 12),
                        Text(_setupKeyLabel(locale), style: const TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 6),
                        SelectableText(enrollmentSecret!, textAlign: TextAlign.center, style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700)),
                      ],
                      const SizedBox(height: 12),
                      TextField(controller: mfa, keyboardType: TextInputType.number, maxLength: 6, onSubmitted: (_) => submit(), decoration: InputDecoration(labelText: cpText(locale, 'auth.mfaCode'), border: const OutlineInputBorder())),
                    ],
                    if (error != null) ...[
                      const SizedBox(height: 12),
                      Text(error!, style: const TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.w600)),
                    ],
                    const SizedBox(height: 18),
                    FilledButton(
                      onPressed: busy ? null : submit,
                      style: FilledButton.styleFrom(backgroundColor: widget.accent, minimumSize: const Size.fromHeight(52)),
                      child: busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(challengeId == null ? cpText(locale, 'auth.signIn') : cpText(locale, 'auth.verify')),
                    ),
                    if (challengeId != null) ...[
                      const SizedBox(height: 8),
                      TextButton(onPressed: busy ? null : resetChallenge, child: Text(_differentAccountLabel(locale))),
                    ],
                    const SizedBox(height: 12),
                    Text('${cpText(locale, 'auth.api')}: ${api.baseUrl}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8))),
                  ]),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String _enrollmentPrompt(CarePointLocale locale) => switch (locale) {
  CarePointLocale.en => 'Multi-factor authentication is required for provider access. Add the setup key to your authenticator app, then enter the generated 6-digit code.',
  CarePointLocale.ar => 'التحقق متعدد العوامل مطلوب لوصول مقدم الخدمة. أضف مفتاح الإعداد إلى تطبيق المصادقة ثم أدخل الرمز المكون من 6 أرقام.',
  CarePointLocale.fr => 'L’authentification multifacteur est obligatoire pour l’accès prestataire. Ajoutez la clé à votre application d’authentification puis saisissez le code à 6 chiffres.',
  CarePointLocale.es => 'La autenticación multifactor es obligatoria para el acceso del proveedor. Añade la clave a tu aplicación de autenticación e introduce el código de 6 dígitos.',
};

String _setupKeyLabel(CarePointLocale locale) => switch (locale) {
  CarePointLocale.en => 'Authenticator setup key',
  CarePointLocale.ar => 'مفتاح إعداد تطبيق المصادقة',
  CarePointLocale.fr => 'Clé de configuration de l’authentificateur',
  CarePointLocale.es => 'Clave de configuración del autenticador',
};

String _differentAccountLabel(CarePointLocale locale) => switch (locale) {
  CarePointLocale.en => 'Use a different account',
  CarePointLocale.ar => 'استخدام حساب مختلف',
  CarePointLocale.fr => 'Utiliser un autre compte',
  CarePointLocale.es => 'Usar otra cuenta',
};
