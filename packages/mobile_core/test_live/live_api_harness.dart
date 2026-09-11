import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';

/// Separate from hermetic unit tests: actual I/O is permitted only by the
/// opt-in CI harness below. This is headless, not a native-device test binding.
class LocalLiveApiBinding extends AutomatedTestWidgetsFlutterBinding {
  @override
  bool get overrideHttpClient => false;
}

typedef JsonMap = Map<String, dynamic>;
JsonMap asMap(dynamic value) => Map<String, dynamic>.from(value as Map);
List<JsonMap> asRows(dynamic value) => (value as List).map(asMap).toList();

class LoopbackClient extends http.BaseClient {
  LoopbackClient(this.base) : inner = IOClient(HttpClient()..findProxy = ((_) => 'DIRECT'));
  final Uri base;
  final IOClient inner;
  final calls = <String>[];
  final bookingBodies = <String>[];
  bool loseNextBookingReply = false;
  int committedRepliesLost = 0;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.origin != base.origin || !request.url.path.startsWith('${base.path}/')) {
      throw StateError('Live test egress outside the opted-in loopback API is prohibited.');
    }
    request.followRedirects = false;
    calls.add('${request.method} ${request.url.path}');
    final booking = request.method == 'POST' && request.url.path == '${base.path}/bookings';
    if (booking) bookingBodies.add((request as http.Request).body);
    final actual = await inner.send(request).timeout(const Duration(seconds: 15));
    final response = await http.Response.fromStream(actual).timeout(const Duration(seconds: 15));
    // The server has really received and committed this command. Discard only
    // the first successful reply to test ambiguity; never fabricate success.
    if (booking && loseNextBookingReply && response.statusCode >= 200 && response.statusCode < 300) {
      loseNextBookingReply = false; committedRepliesLost++;
      throw http.ClientException('Synthetic reply loss after a real booking commit.');
    }
    return http.StreamedResponse(Stream.value(response.bodyBytes), response.statusCode, headers: response.headers, request: request);
  }
  @override
  void close() => inner.close();
}

class LiveActor {
  LiveActor(this.api, this.client, this.store);
  final CarePointApi api;
  final LoopbackClient client;
  final MemoryCarePointTokenStore store;
  late CarePointSession session;
}

class LiveFixture {
  LiveFixture(this.data);
  final JsonMap data;
  final receipts = <String, JsonMap>{};
  final clients = <LoopbackClient>[];
  Uri get base => Uri.parse(data['apiBase'] as String);
  JsonMap scenario(String key) => asMap(asMap(data['cases'])[key]);
  static Future<LiveFixture> read() async {
    final env = Platform.environment;
    if (env['CI'] != 'true' || env['NODE_ENV'] != 'test' || env['CAREPOINT_MOBILE_LIVE_ACCEPTANCE'] != 'true') {
      throw StateError('F3.2 needs explicit synthetic CI opt-in; it is never silently skipped.');
    }
    final root = await Directory(env['RUNNER_TEMP']!).resolveSymbolicLinks();
    final path = env['CAREPOINT_MOBILE_LIVE_FIXTURE'] ?? '';
    if (path != '$root/carepoint-f3-mobile-fixture.json' || env['CAREPOINT_MOBILE_LIVE_RESULT'] != '$root/carepoint-f3-mobile-result.json') {
      throw StateError('F3.2 requires the private runner temporary paths.');
    }
    final stat = await File(path).stat();
    if (stat.size > 100000 || (stat.mode & 0x3f) != 0) throw StateError('Fixture file is not private and bounded.');
    final value = asMap(jsonDecode(await File(path).readAsString()));
    final base = Uri.parse(value['apiBase'] as String);
    if (value['schemaVersion'] != 1 || value['mode'] != 'SYNTHETIC_LOCAL_ONLY' ||
        base.scheme != 'http' || !['127.0.0.1', 'localhost'].contains(base.host) || base.port != 4000 ||
        base.path != '/api/v1' || base.hasQuery || base.hasFragment || base.userInfo.isNotEmpty) {
      throw StateError('Fixture must address only the isolated loopback API.');
    }
    return LiveFixture(value);
  }
  LiveActor anonymous() {
    final client = LoopbackClient(base); clients.add(client);
    final store = MemoryCarePointTokenStore();
    return LiveActor(CarePointApi(baseUrl: base.toString(), client: client, tokenStore: store), client, store);
  }
  Future<LiveActor> login(JsonMap credentials, String role) async {
    if (!(credentials['email'] as String).endsWith('@example.invalid')) throw StateError('Non-synthetic login prohibited.');
    final actor = anonymous();
    actor.session = await actor.api.login(credentials['email'] as String, credentials['password'] as String);
    expect(actor.session.role, role);
    expect(actor.api.isAuthenticated, true);
    return actor;
  }
  void record(String key, String requestId, String? appointmentId) {
    receipts[key] = {'requestId': requestId, 'appointmentId': appointmentId};
  }
  void closeClients() { for (final client in clients) { client.close(); } clients.clear(); }
  Future<void> writeResults() async {
    expect(receipts.keys.toSet(), {'book', 'retry', 'withdraw', 'isolation'});
    final file = File(Platform.environment['CAREPOINT_MOBILE_LIVE_RESULT']!);
    await file.create(exclusive: true);
    final chmod = await Process.run('chmod', ['600', file.path]);
    if (chmod.exitCode != 0) throw StateError('Cannot protect synthetic result file.');
    await file.writeAsString(jsonEncode({'sourceCommit': data['sourceCommit'], 'runTag': data['runTag'], 'cases': receipts}), flush: true);
  }
}

Future<void> waitForLive(WidgetTester tester, bool Function() ready, String stage) async {
  final elapsed = Stopwatch()..start();
  while (elapsed.elapsed < const Duration(seconds: 15)) {
    await tester.pump(const Duration(milliseconds: 50));
    expect(tester.takeException(), isNull, reason: stage);
    if (ready()) {
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pump();
      return;
    }
    // Called only inside runAsync, so network I/O and the deadline use real time.
    await Future<void>.delayed(const Duration(milliseconds: 25));
  }
  fail('Timed out waiting for live stage: $stage');
}
Future<void> pressLive(WidgetTester tester, Finder finder) async {
  await tester.pump();
  await tester.ensureVisible(finder);
  // A menu label can exist while its route is still outside the hit-test area.
  // Wait for an actual reachable target rather than suppressing missed taps.
  await waitForLive(tester, () => finder.hitTestable().evaluate().length == 1, 'hit-testable action');
  await tester.tap(finder.hitTestable());
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
  await tester.pump();
}
Future<void> openLivePage(WidgetTester tester, Widget page) async {
  await tester.pumpWidget(MaterialApp(key: UniqueKey(), home: Builder(builder: (context) => Scaffold(body: TextButton(
    key: const ValueKey('open-live-page'), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => page)), child: const Text('Open live workspace'),
  )))));
  await pressLive(tester, find.byKey(const ValueKey('open-live-page')));
}
Future<void> runLive(WidgetTester tester, LiveFixture fixture, Future<void> Function() body) async {
  await tester.binding.setSurfaceSize(const Size(1100, 1200));
  var completed = false;
  try {
    await tester.runAsync(() async {
      try { await body(); completed = true; }
      finally { await tester.pumpWidget(const SizedBox.shrink()); await tester.pump(const Duration(milliseconds: 350)); }
    });
    expect(tester.takeException(), isNull);
    expect(completed, true, reason: 'Live scenario must complete all assertions.');
  } finally { fixture.closeClients(); await tester.binding.setSurfaceSize(null); }
}
Future<void> expectStatus(Future<dynamic> operation, int status) async {
  await expectLater(operation, throwsA(isA<CarePointApiException>().having((e) => e.statusCode, 'HTTP status', status)));
}
void assertSafeDemand(JsonMap result) {
  final encoded = jsonEncode(result);
  for (final key in ['patientId', 'patientName', 'requestId', 'appointmentId', 'email', 'phone', 'contactPhone', 'activeKey', 'acceptedKeyHash']) {
    expect(encoded.contains('"$key"'), false, reason: 'Aggregate must omit private field $key');
  }
  expect(result['containsPatientIdentities'], false); expect(result['reservesSlots'], false);
}
