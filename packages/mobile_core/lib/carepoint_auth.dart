import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

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
  String? error;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    api = widget.api ?? CarePointApi();
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
      if (mounted) setState(() { session = next; challengeId = null; });
    } on CarePointMfaRequired catch (value) {
      if (mounted) setState(() => challengeId = value.challengeId);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> signOut() async {
    await api.logout();
    if (mounted) setState(() { session = null; challengeId = null; mfa.clear(); });
  }

  @override
  Widget build(BuildContext context) {
    if (session != null) return widget.builder(context, session!, signOut);
    final locale = widget.locale;
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
                      Text(cpText(locale, 'auth.mfaPrompt')),
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
