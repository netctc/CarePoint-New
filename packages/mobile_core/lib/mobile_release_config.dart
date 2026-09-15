class CarePointMobileConfigurationException implements Exception {
  const CarePointMobileConfigurationException(this.message);

  final String message;

  @override
  String toString() => message;
}

class CarePointMobileReleaseConfig {
  CarePointMobileReleaseConfig._();

  static const String debugDefaultApiBase = 'http://10.0.2.2:4000/api/v1';
  static const String compiledApiBase = String.fromEnvironment('CAREPOINT_API_BASE', defaultValue: '');
  static const String compiledBuildEnvironment = String.fromEnvironment('CAREPOINT_BUILD_ENV', defaultValue: 'development');
  static const String compiledReleaseSha = String.fromEnvironment('CAREPOINT_RELEASE_SHA', defaultValue: '');
  static const bool compiledProductMode = bool.fromEnvironment('dart.vm.product');

  static String resolveApiBase({
    String? override,
    bool? releaseMode,
    String? buildEnvironment,
    String? releaseSha,
  }) {
    final isRelease = releaseMode ?? compiledProductMode;
    final environment = (buildEnvironment ?? compiledBuildEnvironment).trim().toLowerCase();
    final configured = (override ?? compiledApiBase).trim();

    if (isRelease) {
      if (environment != 'staging' && environment != 'production') {
        throw const CarePointMobileConfigurationException(
          'Release mobile builds require CAREPOINT_BUILD_ENV=staging or production.',
        );
      }
      validateReleaseSourceSha(
        value: releaseSha,
        releaseMode: true,
      );
      if (configured.isEmpty) {
        throw const CarePointMobileConfigurationException(
          'Release mobile builds require CAREPOINT_API_BASE.',
        );
      }
    }

    final resolved = configured.isEmpty ? debugDefaultApiBase : configured;
    final uri = Uri.tryParse(resolved);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw const CarePointMobileConfigurationException('CAREPOINT_API_BASE must be an absolute HTTP(S) URL.');
    }
    final scheme = uri.scheme.toLowerCase();
    if (scheme != 'http' && scheme != 'https') {
      throw const CarePointMobileConfigurationException('CAREPOINT_API_BASE must use HTTP or HTTPS.');
    }

    if (isRelease) {
      if (scheme != 'https') {
        throw const CarePointMobileConfigurationException('Release mobile builds require an HTTPS API endpoint.');
      }
      if (_isDevelopmentOnlyHost(uri.host)) {
        throw const CarePointMobileConfigurationException(
          'Release mobile builds cannot use localhost, emulator, test, example or invalid API hosts.',
        );
      }
    }

    return resolved.replaceAll(RegExp(r'/+$'), '');
  }

  static String validateReleaseSourceSha({String? value, bool? releaseMode}) {
    final isRelease = releaseMode ?? compiledProductMode;
    final sha = (value ?? compiledReleaseSha).trim().toLowerCase();
    if (!isRelease) return sha;
    if (!RegExp(r'^[0-9a-f]{40}$').hasMatch(sha)) {
      throw const CarePointMobileConfigurationException(
        'Release mobile builds require CAREPOINT_RELEASE_SHA as a full 40-character Git commit SHA.',
      );
    }
    return sha;
  }

  static bool _isDevelopmentOnlyHost(String host) {
    final normalized = host.trim().toLowerCase();
    if (normalized == 'localhost' || normalized == '0.0.0.0' || normalized == '::1' || normalized == '10.0.2.2') {
      return true;
    }
    if (normalized.startsWith('127.')) return true;
    if (normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
    if (normalized.endsWith('.test') || normalized.endsWith('.example') || normalized.endsWith('.invalid')) return true;
    return false;
  }
}
