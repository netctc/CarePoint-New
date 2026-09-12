import 'package:carepoint_mobile_core/mobile_release_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const validSha = '0123456789abcdef0123456789abcdef01234567';

  test('development builds keep emulator fallback when no API base is configured', () {
    expect(
      CarePointMobileReleaseConfig.resolveApiBase(
        override: '',
        releaseMode: false,
        buildEnvironment: 'development',
      ),
      CarePointMobileReleaseConfig.debugDefaultApiBase,
    );
  });

  test('development builds may use an explicit local HTTP endpoint', () {
    expect(
      CarePointMobileReleaseConfig.resolveApiBase(
        override: 'http://127.0.0.1:4100/api/v1/',
        releaseMode: false,
        buildEnvironment: 'development',
      ),
      'http://127.0.0.1:4100/api/v1',
    );
  });

  test('release builds require staging or production environment', () {
    expect(
      () => CarePointMobileReleaseConfig.resolveApiBase(
        override: 'https://api.carepoint.health/api/v1',
        releaseMode: true,
        buildEnvironment: 'development',
        releaseSha: validSha,
      ),
      throwsA(isA<CarePointMobileConfigurationException>()),
    );
  });

  test('release builds require an explicit API base', () {
    expect(
      () => CarePointMobileReleaseConfig.resolveApiBase(
        override: '',
        releaseMode: true,
        buildEnvironment: 'production',
        releaseSha: validSha,
      ),
      throwsA(isA<CarePointMobileConfigurationException>()),
    );
  });

  test('release builds reject non-HTTPS and development-only hosts', () {
    for (final endpoint in <String>[
      'http://api.carepoint.health/api/v1',
      'https://localhost/api/v1',
      'https://127.0.0.1/api/v1',
      'https://10.0.2.2/api/v1',
      'https://carepoint.test/api/v1',
      'https://carepoint.example/api/v1',
      'https://carepoint.invalid/api/v1',
    ]) {
      expect(
        () => CarePointMobileReleaseConfig.resolveApiBase(
          override: endpoint,
          releaseMode: true,
          buildEnvironment: 'production',
          releaseSha: validSha,
        ),
        throwsA(isA<CarePointMobileConfigurationException>()),
        reason: endpoint,
      );
    }
  });

  test('release builds require a full exact source SHA', () {
    for (final sha in <String>['', 'abc123', 'g123456789abcdef0123456789abcdef01234567']) {
      expect(
        () => CarePointMobileReleaseConfig.resolveApiBase(
          override: 'https://api.carepoint.health/api/v1',
          releaseMode: true,
          buildEnvironment: 'production',
          releaseSha: sha,
        ),
        throwsA(isA<CarePointMobileConfigurationException>()),
        reason: sha,
      );
    }
  });

  test('release builds accept normalized HTTPS endpoint plus exact source SHA', () {
    expect(
      CarePointMobileReleaseConfig.resolveApiBase(
        override: 'https://api.carepoint.health/api/v1/',
        releaseMode: true,
        buildEnvironment: 'production',
        releaseSha: validSha,
      ),
      'https://api.carepoint.health/api/v1',
    );
    expect(
      CarePointMobileReleaseConfig.resolveApiBase(
        override: 'https://staging-api.carepoint.health/api/v1',
        releaseMode: true,
        buildEnvironment: 'staging',
        releaseSha: validSha,
      ),
      'https://staging-api.carepoint.health/api/v1',
    );
  });
}
