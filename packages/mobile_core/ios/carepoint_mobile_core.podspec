Pod::Spec.new do |s|
  s.name             = 'carepoint_mobile_core'
  s.version          = '0.5.0'
  s.summary          = 'CarePoint shared mobile core with governed native photo capture.'
  s.description      = <<-DESC
CarePoint shared Flutter mobile core. Includes the internal camera/gallery bridge used by consented clinical field-media capture.
                       DESC
  s.homepage         = 'https://github.com/netctc/CarePoint-New'
  s.license          = { :type => 'Proprietary', :text => 'Internal CarePoint source' }
  s.author           = { 'CarePoint' => 'engineering@carepoint.local' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency 'Flutter'
  s.platform = :ios, '13.0'
  s.swift_version = '5.0'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
