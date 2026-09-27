import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'persistent language menu and bottom navigation stay interactive across page routes',
    (tester) async {
      final controller = CarePointSessionUiController();
      final navigatorKey = GlobalKey<NavigatorState>();
      final observer = CarePointSessionNavigatorObserver();
      var locale = CarePointLocale.en;
      var selectedIndex = 0;

      controller.bind(() {});
      controller.bindNavigation(
        selectedIndex: selectedIndex,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.folder_outlined),
            selectedIcon: Icon(Icons.folder),
            label: 'Records',
          ),
        ],
        onSelected: (value) {
          selectedIndex = value;
          navigatorKey.currentState?.popUntil((route) => route.isFirst);
          controller.updateNavigationIndex(value);
        },
      );

      await tester.pumpWidget(
        StatefulBuilder(
          builder: (context, setState) => MaterialApp(
            navigatorKey: navigatorKey,
            navigatorObservers: [observer],
            builder: (context, child) => CarePointSessionChrome(
              controller: controller,
              navigatorKey: navigatorKey,
              navigatorObserver: observer,
              locale: locale,
              onLocaleChanged: (value) {
                setState(() => locale = value);
              },
              child: child ?? const SizedBox.shrink(),
            ),
            home: Scaffold(
              appBar: AppBar(title: const Text('CarePoint')),
              body: Center(
                child: FilledButton(
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const Scaffold(
                          body: Center(child: Text('Second page')),
                        ),
                      ),
                    );
                  },
                  child: const Text('Push page'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.language_rounded), findsOneWidget);
      expect(find.text('Home'), findsOneWidget);
      expect(find.text('Records'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.language_rounded));
      await tester.pumpAndSettle();
      expect(find.text(CarePointLocale.es.label), findsOneWidget);

      await tester.tap(find.text(CarePointLocale.es.label));
      await tester.pumpAndSettle();
      expect(locale, CarePointLocale.es);

      await tester.tap(find.text('Push page'));
      await tester.pumpAndSettle();
      expect(find.text('Second page'), findsOneWidget);
      expect(find.text('Records'), findsOneWidget);

      await tester.tap(find.text('Records'));
      await tester.pumpAndSettle();
      expect(selectedIndex, 1);
      expect(find.text('Second page'), findsNothing);

      controller.dispose();
    },
  );
}
