module.exports = {
  ...require('@ionic/swiftlint-config'),
  excluded: [...require('@ionic/swiftlint-config').excluded, '${PWD}/.build', '${PWD}/build', '${PWD}/playground'],
};
