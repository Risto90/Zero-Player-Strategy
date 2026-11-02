const isNativeEasBuild = process.env.APP_BUILD_TARGET === 'native';

module.exports = ({ config }) => {
  if (!isNativeEasBuild) {
    return config;
  }

  return {
    ...config,
    owner: 'phoenix-castle',
    slug: 'zsg',
    platforms: ['web', 'android', 'ios'],
    android: {
      ...config.android,
      package: 'ru.beska.zsg',
    },
    ios: {
      ...config.ios,
      bundleIdentifier: 'ru.beska.zsg',
    },
    extra: {
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        projectId: 'de36eb3a-da79-482d-906e-38a056f7d669',
      },
    },
  };
};
