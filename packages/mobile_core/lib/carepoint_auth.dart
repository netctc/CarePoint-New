import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'mfa_enrollment_api.dart';
import 'mfa_setup_panel.dart';
import 'mobile_release_config.dart';
import 'registration_flow.dart';

typedef CarePointAuthenticatedBuilder = Widget Function(BuildContext context, CarePointSession session, VoidCallback signOut);

class CarePointPersistentNavigation {
  const CarePointPersistentNavigation({
    required this.selectedIndex,
    required this.destinations,
    required this.onSelected,
  });

  final int selectedIndex;
  final List<NavigationDestination> destinations;
  final ValueChanged<int> onSelected;

  CarePointPersistentNavigation copyWith({int? selectedIndex}) =>
      CarePointPersistentNavigation(
        selectedIndex: selectedIndex ?? this.selectedIndex,
        destinations: destinations,
        onSelected: onSelected,
      );
}

class CarePointSessionUiController extends ChangeNotifier {
  VoidCallback? _signOut;
  CarePointPersistentNavigation? _navigation;

  bool get hasSession => _signOut != null;
  CarePointPersistentNavigation? get navigation => _navigation;

  void bind(VoidCallback signOut) {
    _signOut = signOut;
    notifyListeners();
  }

  void bindNavigation({
    required int selectedIndex,
    required List<NavigationDestination> destinations,
    required ValueChanged<int> onSelected,
  }) {
    _navigation = CarePointPersistentNavigation(
      selectedIndex: selectedIndex,
      destinations: List<NavigationDestination>.unmodifiable(destinations),
      onSelected: onSelected,
    );
    notifyListeners();
  }

  void updateNavigationIndex(int selectedIndex) {
    final current = _navigation;
    if (current == null || current.selectedIndex == selectedIndex) return;
    _navigation = current.copyWith(selectedIndex: selectedIndex);
    notifyListeners();
  }

  void clearNavigation() {
    if (_navigation == null) return;
    _navigation = null;
    notifyListeners();
  }

  void clear() {
    final changed = _signOut != null || _navigation != null;
    _signOut = null;
    _navigation = null;
    if (changed) notifyListeners();
  }

  void signOut() => _signOut?.call();
}

class CarePointSessionChrome extends StatefulWidget {
  const CarePointSessionChrome({
    super.key,
    required this.controller,
    required this.locale,
    required this.onLocaleChanged,
    required this.child,
    this.dark = false,
  });

  final CarePointSessionUiController controller;
  final CarePointLocale locale;
  final ValueChanged<CarePointLocale> onLocaleChanged;
  final Widget child;
  final bool dark;

  @override
  State<CarePointSessionChrome> createState() => _CarePointSessionChromeState();
}

class _CarePointSessionChromeState extends State<CarePointSessionChrome> {
  bool languageOpen = false;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: widget.controller,
        builder: (context, _) {
          final navigation =
              widget.controller.hasSession ? widget.controller.navigation : null;
          final topInset = MediaQuery.paddingOf(context).top;

          return Scaffold(
            backgroundColor: Colors.transparent,
            body: Stack(
              fit: StackFit.expand,
              clipBehavior: Clip.none,
              children: [
                Positioned.fill(child: widget.child),
                PositionedDirectional(
                  top: topInset + 4,
                  end: 8,
                  child: Material(
                    color: Colors.transparent,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            IconButton(
                              onPressed: () => setState(
                                () => languageOpen = !languageOpen,
                              ),
                              icon: const Icon(Icons.language_rounded),
                            ),
                            if (languageOpen)
                              Material(
                                elevation: 8,
                                borderRadius: BorderRadius.circular(12),
                                color: Theme.of(context).colorScheme.surface,
                                child: ConstrainedBox(
                                  constraints: const BoxConstraints(
                                    minWidth: 180,
                                    maxWidth: 220,
                                  ),
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: CarePointLocale.values
                                        .map(
                                          (value) => _CarePointLanguageChoice(
                                            value: value,
                                            selected: value == widget.locale,
                                            onSelected: () {
                                              setState(
                                                () => languageOpen = false,
                                              );
                                              if (value != widget.locale) {
                                                widget.onLocaleChanged(value);
                                              }
                                            },
                                          ),
                                        )
                                        .toList(growable: false),
                                  ),
                                ),
                              ),
                          ],
                        ),
                        if (widget.controller.hasSession)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: TextButton.icon(
                              onPressed: widget.controller.signOut,
                              icon: const Icon(Icons.logout_rounded),
                              label: Text(
                                cpText(widget.locale, 'auth.signOut'),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            bottomNavigationBar: navigation == null
                ? null
                : _CarePointWebSafeBottomNavigation(
                    navigation: navigation,
                  ),
          );
        },
      );
}

class _CarePointLanguageChoice extends StatelessWidget {
  const _CarePointLanguageChoice({
    required this.value,
    required this.selected,
    required this.onSelected,
  });

  final CarePointLocale value;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) => MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onSelected,
          child: SizedBox(
            height: 46,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  SizedBox(
                    width: 28,
                    child: selected
                        ? const Icon(Icons.check_rounded, size: 18)
                        : null,
                  ),
                  Expanded(child: Text(value.label)),
                ],
              ),
            ),
          ),
        ),
      );
}

class _CarePointWebSafeBottomNavigation extends StatelessWidget {
  const _CarePointWebSafeBottomNavigation({
    required this.navigation,
  });

  final CarePointPersistentNavigation navigation;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    final selectedColor = theme.colorScheme.primary;
    final unselectedColor = theme.colorScheme.onSurfaceVariant;

    return Material(
      elevation: 12,
      color: theme.colorScheme.surface,
      child: Padding(
        padding: EdgeInsets.only(bottom: bottomInset),
        child: SizedBox(
          height: 72,
          child: Row(
            children: [
              for (var index = 0;
                  index < navigation.destinations.length;
                  index++)
                Expanded(
                  child: _CarePointWebSafeDestination(
                    destination: navigation.destinations[index],
                    selected: navigation.selectedIndex == index,
                    selectedColor: selectedColor,
                    unselectedColor: unselectedColor,
                    onTap: () => navigation.onSelected(index),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CarePointWebSafeDestination extends StatelessWidget {
  const _CarePointWebSafeDestination({
    required this.destination,
    required this.selected,
    required this.selectedColor,
    required this.unselectedColor,
    required this.onTap,
  });

  final NavigationDestination destination;
  final bool selected;
  final Color selectedColor;
  final Color unselectedColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? selectedColor : unselectedColor;
    return Semantics(
      button: true,
      selected: selected,
      label: destination.label,
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconTheme(
                    data: IconThemeData(color: color, size: 24),
                    child: selected
                        ? (destination.selectedIcon ?? destination.icon)
                        : destination.icon,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    destination.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: color,
                          fontWeight:
                              selected ? FontWeight.w800 : FontWeight.w600,
                        ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class CarePointLoginGate extends StatefulWidget {
  const CarePointLoginGate({
    super.key,
    required this.locale,
    required this.expectedRole,
    required this.title,
    required this.builder,
    this.api,
    this.sessionUiController,
    this.accent = const Color(0xFF0EA5E9),
    this.dark = false,
  });

  final CarePointLocale locale;
  final String expectedRole;
  final String title;
  final CarePointAuthenticatedBuilder builder;
  final CarePointApi? api;
  final CarePointSessionUiController? sessionUiController;
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
  String? enrollmentUri;
  String? error;
  bool busy = false;
  bool restoring = true;

  @override
  void initState() {
    super.initState();
    api = widget.api ?? CarePointApi(baseUrl: CarePointMobileReleaseConfig.resolveApiBase());
    api.onSessionInvalidated = _handleSessionInvalidated;
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    try {
      final restored = await api.restoreSession();
      if (restored != null && restored.role == widget.expectedRole) {
        if (mounted) {
          setState(() => session = restored);
          widget.sessionUiController?.bind(signOut);
        }
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
      if (mounted) {
        setState(() { session = next; challengeId = null; enrollmentSecret = null; enrollmentUri = null; });
        widget.sessionUiController?.bind(signOut);
      }
    } on CarePointMfaRequired catch (value) {
      await _adoptMfaChallenge(value);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _adoptMfaChallenge(CarePointMfaRequired value) async {
    String? setupSecret;
    String? setupUri;
    if (value.challengeId.startsWith('mfaenroll_')) {
      try {
        final setup = await api.beginRequiredMfaEnrollment(value.challengeId);
        setupSecret = setup['secret'];
        setupUri = setup['otpauthUri'];
      } catch (setupError) {
        if (mounted) setState(() => error = setupError.toString());
      }
    }
    if (!mounted) return;
    setState(() {
      challengeId = value.challengeId;
      enrollmentSecret = setupSecret;
      enrollmentUri = setupUri;
      password.clear();
      mfa.clear();
    });
  }

  Future<void> registerAccount() async {
    try {
      final result = await showCarePointRegistrationFlow(
        context,
        api: api,
        locale: widget.locale,
        expectedRole: widget.expectedRole,
        accent: widget.accent,
        dark: widget.dark,
      );
      if (result == null || !mounted) return;

      final mfaChallenge = result.mfaChallenge;
      if (mfaChallenge != null) {
        await _adoptMfaChallenge(mfaChallenge);
        return;
      }

      final next = result.session;
      if (next == null) return;
      if (next.role != widget.expectedRole) {
        await api.logout();
        throw CarePointApiException(
          'Registered account belongs to ${next.role}, not ${widget.expectedRole}.',
        );
      }
      setState(() => session = next);
      widget.sessionUiController?.bind(signOut);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    }
  }

  Future<void> signOut() async {
    widget.sessionUiController?.clear();
    try {
      await api.signOutCurrentSession();
    } finally {
      _resetToLogin();
    }
  }

  void _handleSessionInvalidated() {
    widget.sessionUiController?.clear();
    _resetToLogin();
  }

  void _resetToLogin() {
    if (!mounted) return;
    final navigator = Navigator.maybeOf(context);
    if (navigator != null) {
      navigator.popUntil((route) => route.isFirst);
    }
    setState(() {
      session = null;
      challengeId = null;
      enrollmentSecret = null;
      enrollmentUri = null;
      error = null;
      mfa.clear();
    });
  }

  void resetChallenge() {
    setState(() {
      challengeId = null;
      enrollmentSecret = null;
      enrollmentUri = null;
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
                      TextField(
                        controller: email,
                        keyboardType: TextInputType.text,
                        autofillHints: const [AutofillHints.username],
                        decoration: InputDecoration(
                          labelText: _identityLabel(locale),
                          border: const OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(controller: password, obscureText: true, autofillHints: const [AutofillHints.password], onSubmitted: (_) => submit(), decoration: InputDecoration(labelText: cpText(locale, 'auth.password'), border: const OutlineInputBorder())),
                    ] else ...[
                      if (enrollment)
                        CarePointMfaSetupPanel(
                          locale: locale,
                          secret: enrollmentSecret!,
                          otpauthUri: enrollmentUri ?? '',
                        )
                      else
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
                    if (challengeId == null) ...[
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        onPressed: busy ? null : registerAccount,
                        icon: const Icon(Icons.person_add_alt_1_rounded),
                        label: Text(_registerLabel(locale)),
                      ),
                    ],
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


String _languageLabel(CarePointLocale locale) => switch (locale) {
  CarePointLocale.en => 'Language',
  CarePointLocale.ar => 'اللغة',
  CarePointLocale.fr => 'Langue',
  CarePointLocale.es => 'Idioma',
};


String _identityLabel(CarePointLocale locale) => switch (locale) {
  CarePointLocale.en => 'Email or username',
  CarePointLocale.ar => 'البريد الإلكتروني أو اسم المستخدم',
  CarePointLocale.fr => 'E-mail ou nom d’utilisateur',
  CarePointLocale.es => 'Correo electrónico o nombre de usuario',
};

String _registerLabel(CarePointLocale locale) => switch (locale) {
  CarePointLocale.en => 'Register',
  CarePointLocale.ar => 'تسجيل',
  CarePointLocale.fr => 'S’inscrire',
  CarePointLocale.es => 'Registrarse',
};
