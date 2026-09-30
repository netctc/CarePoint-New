import 'package:flutter/material.dart';

/// CarePoint V2 shared design foundations.
/// Phase 0 declaration only; existing user-facing screens do not import it.
abstract final class CarePointV2DesignTokens {
  static const Color surface = Color(0xFFFAF8FF);
  static const Color canvas = Color(0xFFF8FAFC);
  static const Color card = Color(0xFFFFFFFF);
  static const Color surfaceLow = Color(0xFFF2F3FF);
  static const Color surfaceHigh = Color(0xFFE2E7FF);
  static const Color ink = Color(0xFF131B2E);
  static const Color muted = Color(0xFF6E7881);
  static const Color outline = Color(0xFFD8E0EA);
  static const Color clinicalBlue = Color(0xFF0EA5E9);
  static const Color clinicalBlueDeep = Color(0xFF006591);
  static const Color neuralViolet = Color(0xFF8B5CF6);
  static const Color cyanSignal = Color(0xFF22D3EE);
  static const Color midnight = Color(0xFF0F172A);
  static const Color careGreen = Color(0xFF10B981);
  static const Color attention = Color(0xFFF59E0B);
  static const Color safety = Color(0xFFFB7185);

  static const double spacing1 = 8;
  static const double spacing2 = 16;
  static const double spacing3 = 24;
  static const double spacing4 = 32;
  static const double spacing5 = 40;
  static const double spacing6 = 48;
  static const double controlRadius = 12;
  static const double cardRadius = 22;
  static const double overlayRadius = 28;
}

abstract final class CarePointV2Modality {
  static const String clinic = 'CLINIC';
  static const String telemedicine = 'TELEMEDICINE';
  static const String homeVisit = 'HOME_VISIT';
  static const String transport = 'TRANSPORT';
  static const Set<String> values = {clinic, telemedicine, homeVisit, transport};
}

abstract final class CarePointV2Accessibility {
  static const bool statusRequiresText = true;
  static const bool statusRequiresNonColorSignal = true;
  static const bool criticalDataUsesSolidSurface = true;
  static const bool rtlSupported = true;
}
