Pod::Spec.new do |s|
  s.name = 'BoomboxNative'
  s.version = '1.0.0'
  s.summary = 'Module natif Boombox'
  s.license = 'UNLICENSED'
  s.homepage = 'https://github.com'
  s.author = 'Boombox'
  s.source = { :git => 'https://github.com', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '13.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end