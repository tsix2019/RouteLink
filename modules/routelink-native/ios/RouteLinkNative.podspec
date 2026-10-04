Pod::Spec.new do |s|
  s.name           = 'RouteLinkNative'
  s.version        = '0.1.0'
  s.summary        = 'RouteLink native networking'
  s.description    = 'HTTP with certificate pinning, network info and Wake-on-LAN for RouteLink'
  s.author         = 'tsix2019'
  s.homepage       = 'https://github.com/tsix2019/RouteLink'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Network', 'Security'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
