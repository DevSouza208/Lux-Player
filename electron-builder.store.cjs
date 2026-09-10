// Valores públicos disponíveis em Partner Center > Identidade do produto.
const identityName = process.env.LUX_STORE_IDENTITY;
const publisher = process.env.LUX_STORE_PUBLISHER;
const publisherDisplayName = process.env.LUX_STORE_PUBLISHER_NAME;
if (!identityName || !publisher || !publisherDisplayName) {
  throw new Error('Informe LUX_STORE_IDENTITY, LUX_STORE_PUBLISHER e LUX_STORE_PUBLISHER_NAME com os valores do Partner Center.');
}
module.exports = {
  ...require('./package.json').build,
  directories: { output: 'release/store' },
  artifactName: 'Lux-Play-Store-${version}-${arch}.${ext}',
  win: { target: [{ target: 'appx', arch: ['x64'] }], icon: 'lux.ico' },
  appx: {
    identityName, publisher, publisherDisplayName,
    applicationId: 'LuxPlay', displayName: 'Lux Play',
    languages: ['pt-BR'], backgroundColor: '#180f29'
  },
  publish: null
};
