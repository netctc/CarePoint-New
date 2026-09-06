import 'dart:async';

import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class TelehealthActionButton extends StatelessWidget {
  const TelehealthActionButton({super.key, required this.session, required this.locale, required this.appointment, this.providerMode = false});

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final bool providerMode;

  @override
  Widget build(BuildContext context) {
    if (appointment['modality'] != 'TELEMEDICINE' || appointment['status'] != 'CONFIRMED') return const SizedBox.shrink();
    return FilledButton.icon(
      onPressed: () => Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => Directionality(
            textDirection: locale.textDirection,
            child: TelehealthRoomPage(session: session, locale: locale, appointment: appointment, providerMode: providerMode),
          ),
        ),
      ),
      icon: const Icon(Icons.video_call_outlined),
      label: Text(cpText(locale, 'telehealth.open')),
    );
  }
}

class TelehealthRoomPage extends StatefulWidget {
  const TelehealthRoomPage({super.key, required this.session, required this.locale, required this.appointment, required this.providerMode});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final bool providerMode;

  @override
  State<TelehealthRoomPage> createState() => _TelehealthRoomPageState();
}

class _TelehealthRoomPageState extends State<TelehealthRoomPage> {
  Map<String, dynamic>? state;
  Room? room;
  bool busy = true;
  bool connecting = false;
  bool checking = false;
  String? error;

  String get appointmentId => widget.appointment['id'].toString();
  CarePointApi get api => widget.session.api;
  CarePointLocale get locale => widget.locale;
  bool get isPatient => widget.session.role == 'PATIENT';

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    final current = room;
    if (current != null) unawaited(current.dispose());
    super.dispose();
  }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final value = await api.telehealthStatus(appointmentId);
      if (mounted) setState(() => state = value);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> grantConsent() async {
    try {
      final value = await api.confirmTelehealthConsent(appointmentId);
      if (mounted) setState(() => state = value);
    } catch (value) { _show(value); }
  }

  Future<void> runReadiness() async {
    setState(() => checking = true);
    LocalAudioTrack? audio;
    LocalVideoTrack? video;
    var microphone = false;
    var camera = false;
    try {
      await LiveKitClient.initialize();
      try { audio = await LocalAudioTrack.create(); microphone = true; } catch (_) { microphone = false; }
      try { video = await LocalVideoTrack.createCameraTrack(); camera = true; } catch (_) { camera = false; }
      final value = await api.updateTelehealthReadiness(appointmentId, camera: camera, microphone: microphone, network: true);
      if (mounted) setState(() => state = value);
      if (!camera || !microphone) _show(CarePointApiException(cpText(locale, 'telehealth.deviceFailed')));
    } catch (value) {
      _show(value);
    } finally {
      if (audio != null) await audio.stop();
      if (video != null) await video.stop();
      if (mounted) setState(() => checking = false);
    }
  }

  Future<void> join() async {
    setState(() { connecting = true; error = null; });
    try {
      final credentials = await api.telehealthJoin(appointmentId);
      final key = credentials['e2eeKey']?.toString();
      final serverUrl = credentials['serverUrl']?.toString();
      final participantToken = credentials['participantToken']?.toString();
      if (key == null || key.isEmpty || serverUrl == null || serverUrl.isEmpty || participantToken == null || participantToken.isEmpty) {
        throw const CarePointApiException('Telehealth credentials are incomplete.');
      }

      await LiveKitClient.initialize();
      final encryption = await E2EEOptions.sharedKey(key);
      final nextRoom = Room(roomOptions: RoomOptions(adaptiveStream: true, dynacast: true, encryption: encryption));
      nextRoom.addListener(_roomChanged);
      await nextRoom.prepareConnection(serverUrl, participantToken);
      await nextRoom.connect(serverUrl, participantToken);
      final localParticipant = nextRoom.localParticipant;
      if (localParticipant == null) {
        await nextRoom.dispose();
        throw const CarePointApiException('LiveKit did not create a local participant.');
      }
      await localParticipant.setMicrophoneEnabled(true);
      try { await localParticipant.setCameraEnabled(true); } catch (value) { _show(value); }
      if (!mounted) {
        await nextRoom.dispose();
        return;
      }
      setState(() => room = nextRoom);
      await load();
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => connecting = false);
    }
  }

  void _roomChanged() {
    if (mounted) setState(() {});
  }

  Future<void> toggleCamera() async {
    final localParticipant = room?.localParticipant;
    if (localParticipant == null) return;
    await localParticipant.setCameraEnabled(!localParticipant.isCameraEnabled());
    if (mounted) setState(() {});
  }

  Future<void> toggleMicrophone() async {
    final localParticipant = room?.localParticipant;
    if (localParticipant == null) return;
    await localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled());
    if (mounted) setState(() {});
  }

  Future<void> leave({bool endForEveryone = false}) async {
    final current = room;
    if (endForEveryone && widget.providerMode) {
      try { await api.endTelehealth(appointmentId); } catch (value) { _show(value); return; }
    }
    if (current != null) {
      await current.disconnect();
      current.removeListener(_roomChanged);
      await current.dispose();
    }
    room = null;
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFF07111F),
        appBar: AppBar(
          backgroundColor: const Color(0xFF07111F),
          foregroundColor: Colors.white,
          title: Text(cpText(locale, 'telehealth.title')),
          actions: [IconButton(onPressed: load, icon: const Icon(Icons.refresh_rounded))],
        ),
        body: busy
            ? const Center(child: CircularProgressIndicator())
            : error != null && state == null
                ? _centerError()
                : room == null
                    ? _waitingRoom()
                    : _connectedRoom(),
      );

  Widget _waitingRoom() {
    final value = state ?? const <String, dynamic>{};
    final consent = value['consentGranted'] == true;
    final ready = value['participantReady'] == true;
    final canJoin = value['canJoin'] == true;
    final status = value['status']?.toString() ?? 'WAITING';
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(color: const Color(0xFF101D31), borderRadius: BorderRadius.circular(24), border: Border.all(color: const Color(0xFF22334D))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(status, style: const TextStyle(color: Color(0xFF67E8F9), fontWeight: FontWeight.w900, letterSpacing: 1.1)),
            const SizedBox(height: 8),
            Text(cpText(locale, 'telehealth.waitingRoom'), style: const TextStyle(color: Colors.white, fontSize: 25, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(cpText(locale, 'telehealth.encrypted'), style: const TextStyle(color: Color(0xFF94A3B8), height: 1.4)),
            const SizedBox(height: 14),
            const Row(children: [Icon(Icons.lock_outline, color: Color(0xFF10B981), size: 18), SizedBox(width: 7), Text('E2EE', style: TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.w800)), Spacer(), Icon(Icons.fiber_manual_record, color: Color(0xFF94A3B8), size: 12), SizedBox(width: 5), Text('Recording OFF', style: TextStyle(color: Color(0xFF94A3B8)))]),
          ]),
        ),
        const SizedBox(height: 16),
        if (isPatient && !consent)
          _step(Icons.verified_user_outlined, cpText(locale, 'telehealth.consent'), cpText(locale, 'telehealth.consentText'), FilledButton(onPressed: grantConsent, child: Text(cpText(locale, 'telehealth.acceptConsent'))))
        else
          _step(Icons.verified_user_outlined, cpText(locale, 'telehealth.consent'), cpText(locale, consent ? 'telehealth.complete' : 'telehealth.waitingConsent'), const Icon(Icons.check_circle, color: Color(0xFF10B981))),
        const SizedBox(height: 12),
        _step(Icons.devices_outlined, cpText(locale, 'telehealth.deviceCheck'), ready ? cpText(locale, 'telehealth.complete') : cpText(locale, 'telehealth.deviceText'), FilledButton.icon(onPressed: checking ? null : runReadiness, icon: const Icon(Icons.fact_check_outlined), label: Text(checking ? cpText(locale, 'common.loading') : cpText(locale, 'telehealth.runCheck')))),
        const SizedBox(height: 18),
        FilledButton.icon(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56), backgroundColor: const Color(0xFF0EA5E9)),
          onPressed: canJoin && !connecting ? join : null,
          icon: connecting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.video_call),
          label: Text(connecting ? cpText(locale, 'telehealth.connecting') : cpText(locale, 'telehealth.join')),
        ),
        if (!canJoin) Padding(padding: const EdgeInsets.only(top: 10), child: Text(cpText(locale, 'telehealth.joinHint'), style: const TextStyle(color: Color(0xFF94A3B8)), textAlign: TextAlign.center)),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: const TextStyle(color: Color(0xFFFDA4AF)), textAlign: TextAlign.center)),
      ],
    );
  }

  Widget _connectedRoom() {
    final current = room!;
    final remoteTracks = <VideoTrack>[];
    for (final participant in current.remoteParticipants.values) {
      for (final publication in participant.videoTrackPublications) {
        final track = publication.track;
        if (track != null && !publication.muted) remoteTracks.add(track);
      }
    }
    final localParticipant = current.localParticipant;
    VideoTrack? localTrack;
    if (localParticipant != null) {
      for (final publication in localParticipant.videoTrackPublications) {
        final track = publication.track;
        if (track != null && !publication.muted) { localTrack = track; break; }
      }
    }

    return SafeArea(
      child: Column(children: [
        Expanded(
          child: Stack(children: [
            Positioned.fill(child: remoteTracks.isEmpty ? _videoPlaceholder(cpText(locale, 'telehealth.waitingOther')) : VideoTrackRenderer(remoteTracks.first)),
            PositionedDirectional(end: 14, top: 14, width: 128, height: 176, child: ClipRRect(borderRadius: BorderRadius.circular(18), child: localTrack == null ? _videoPlaceholder(cpText(locale, 'telehealth.cameraOff')) : VideoTrackRenderer(localTrack))),
            PositionedDirectional(start: 14, top: 14, child: Chip(avatar: const Icon(Icons.lock, size: 16), label: const Text('E2EE'))),
          ]),
        ),
        Container(
          color: const Color(0xFF0B1628),
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 22),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
            _control(localParticipant?.isMicrophoneEnabled() == true ? Icons.mic : Icons.mic_off, toggleMicrophone),
            _control(localParticipant?.isCameraEnabled() == true ? Icons.videocam : Icons.videocam_off, toggleCamera),
            _control(Icons.call_end, () => leave(endForEveryone: widget.providerMode), destructive: true),
          ]),
        ),
      ]),
    );
  }

  Widget _step(IconData icon, String title, String text, Widget trailing) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: const Color(0xFF101D31), borderRadius: BorderRadius.circular(18)),
        child: Row(children: [Icon(icon, color: const Color(0xFF67E8F9)), const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)), const SizedBox(height: 3), Text(text, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12))])), const SizedBox(width: 10), trailing]),
      );

  Widget _videoPlaceholder(String text) => Container(color: const Color(0xFF111827), alignment: Alignment.center, child: Column(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.person_outline, color: Color(0xFF64748B), size: 54), const SizedBox(height: 8), Text(text, style: const TextStyle(color: Color(0xFF94A3B8))) ]));

  Widget _control(IconData icon, Future<void> Function() action, {bool destructive = false}) => IconButton.filled(
        style: IconButton.styleFrom(backgroundColor: destructive ? const Color(0xFFDC2626) : const Color(0xFF24344E), foregroundColor: Colors.white, minimumSize: const Size(56, 56)),
        onPressed: () { unawaited(action()); },
        icon: Icon(icon),
      );

  Widget _centerError() => Center(child: Padding(padding: const EdgeInsets.all(28), child: Column(mainAxisSize: MainAxisSize.min, children: [Text(error ?? cpText(locale, 'common.error'), style: const TextStyle(color: Colors.white), textAlign: TextAlign.center), const SizedBox(height: 14), FilledButton(onPressed: load, child: Text(cpText(locale, 'common.retry')))])));

  void _show(Object value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
  }
}
