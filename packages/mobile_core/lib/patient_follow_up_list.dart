import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'follow_up_recommendation.dart';

class PatientFollowUpListPage extends StatefulWidget {
  const PatientFollowUpListPage({super.key, required this.session, required this.locale});

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientFollowUpListPage> createState() => _PatientFollowUpListPageState();
}

class _PatientFollowUpListPageState extends State<PatientFollowUpListPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      await widget.session.api.me();
      final token = widget.session.api.accessToken;
      if (token == null || token.isEmpty) throw const CarePointApiException('Authentication is required.');
      final response = await http.get(
        Uri.parse('${widget.session.api.baseUrl}/patient/follow-up-recommendations'),
        headers: {'accept': 'application/json', 'authorization': 'Bearer $token'},
      );
      dynamic payload;
      if (response.body.isNotEmpty) {
        try { payload = jsonDecode(response.body); } catch (_) { payload = response.body; }
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final message = payload is Map && payload['message'] != null ? payload['message'].toString() : 'Request failed (${response.statusCode}).';
        throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
      }
      final rows = payload is Map ? payload['items'] : null;
      if (mounted) setState(() => items = rows is List ? rows.map(_map).toList(growable: false) : const []);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(followUpText(widget.locale, 'title'))),
        body: SafeArea(
          child: busy
              ? const Center(child: CircularProgressIndicator())
              : error != null
                  ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
                  : RefreshIndicator(
                      onRefresh: load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          Card(child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              const Icon(Icons.info_outline),
                              const SizedBox(width: 12),
                              Expanded(child: Text('${followUpText(widget.locale, 'notice')}\n${followUpText(widget.locale, 'booking')}')),
                            ]),
                          )),
                          const SizedBox(height: 12),
                          if (items.isEmpty)
                            Padding(padding: const EdgeInsets.all(24), child: Text(followUpText(widget.locale, 'empty'), textAlign: TextAlign.center))
                          else
                            ...items.map((item) => Card(child: ListTile(
                              leading: const CircleAvatar(child: Icon(Icons.event_repeat_outlined)),
                              title: Text(followUpText(widget.locale, item['recommendationType']?.toString() ?? 'OTHER'), style: const TextStyle(fontWeight: FontWeight.w800)),
                              subtitle: Text(item['recommendedFor'] == null ? followUpText(widget.locale, 'notice') : '${followUpText(widget.locale, 'date')}: ${_date(item['recommendedFor'])}\n${followUpText(widget.locale, 'notice')}'),
                              isThreeLine: item['recommendedFor'] != null,
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () async {
                                final id = item['id']?.toString() ?? '';
                                if (id.isEmpty) return;
                                await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
                                  textDirection: widget.locale.textDirection,
                                  child: PatientFollowUpRecommendationPage(session: widget.session, locale: widget.locale, recommendationId: id),
                                )));
                              },
                            ))),
                        ],
                      ),
                    ),
        ),
      );
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

String _date(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year.toString().padLeft(4, '0')}';
}
