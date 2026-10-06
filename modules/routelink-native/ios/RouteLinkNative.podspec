Pod::Spec.new do |s|
  s.name           = 'RouteLinkNative'
  s.version        = '0.1.0'
  s.summary        = 'RouteLink native networking and SSH'
  s.description    = 'HTTP with certificate pinning, network info, Wake-on-LAN and SSH for RouteLink'
  s.author         = 'tsix2019'
  s.homepage       = 'https://github.com/tsix2019/RouteLink'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Network', 'Security'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"

  # Citadel and its swift-nio-ssh fork compile in Swift 5 mode; Swift 6 would reject their non-Sendable types.
  s.swift_version = '5.9'

  # SSH (design §17). React Native adds the Swift package to the Pods project at `pod install`.
  if defined?(spm_dependency)
    spm_dependency(s,
      url: 'https://github.com/orlandos-nl/Citadel.git',
      requirement: { kind: 'exactVersion', version: '0.12.1' },
      products: ['Citadel']
    )
  else
    raise 'RouteLinkNative needs React Native 0.75 or newer (spm_dependency)'
  end
end
