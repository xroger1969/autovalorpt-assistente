import assert from 'node:assert/strict';
import test from 'node:test';
import { extractInventory, extractVehicleDetails } from '../api/stock.js';

const url = 'https://www.standvirtual.com/carros/anuncio/peugeot-e-2008-ver-elektro-gt-ID8Q1bTl.html';
const otherUrl = 'https://www.standvirtual.com/carros/anuncio/tesla-model-y-ID8TEST2.html';
const space = value => value.replace(/\s/g, ' ');
const nextData = props => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: props } })}</script>`;
const inventory = ads => nextData({ urqlState: { inventory: { data: JSON.stringify({ publishedAds: { ads } }) } } });
const advert = (overrides = {}) => ({
  title: 'Peugeot e-2008 GT', url,
  photos: ['https://images.example.test/peugeot.jpg'],
  price: { currencyCode: 'EUR', grossMinorAmount: 2199000, netMinorAmount: 1787900 },
  attributes: [
    { key: 'model', valueLabel: 'e-2008' },
    { key: 'first_registration_year', value: '2022', valueLabel: '2022' },
    { key: 'mileage', value: '92000', valueLabel: '92000' },
    { key: 'fuel_type', value: 'electric', valueLabel: 'Elétrico' }
  ],
  ...overrides
});

test('usa atributos estruturados da viatura; o modelo e-2008 mantém o ano 2022', () => {
  const [car] = extractInventory(inventory([advert()]));
  assert.equal(car.title, 'Peugeot e-2008 GT');
  assert.equal(car.year, '2022');
  assert.equal(space(car.mileage), '92 000 km');
  assert.equal(space(car.price), '21 990 €');
  assert.equal(car.fuel, 'Elétrico');
  assert.equal(car.image, 'https://images.example.test/peugeot.jpg');
  assert.equal('_reliableTitle' in car, false);
});

test('fallback HTML lê o título h2 e mês/ano sem juntar preço ou quilómetros ao nome', () => {
  const html = `<a href="${url}"><img src="https://images.example.test/peugeot.jpg"></a>
    <a href="${url}"><h2>Peugeot e-2008 GT</h2><ul><li>Elétrico</li><li>Janeiro</li><li>2022</li><li>92 000 km</li></ul><p>21 990</p><span>EUR</span></a>`;
  const [car] = extractInventory(html);
  assert.equal(car.title, 'Peugeot e-2008 GT');
  assert.equal(car.year, '2022');
  assert.equal(space(car.mileage), '92 000 km');
  assert.equal(space(car.price), '21 990 €');
});

test('ausência de ano explícito mantém ano vazio, sem inventar a partir do modelo ou rodapé', () => {
  const [car] = extractInventory(`<a href="${url}"><h2>Peugeot 2008 GT</h2><p>92 000 km · 21 990 EUR</p></a><footer>© 2026 · No Standvirtual desde 2025</footer>`);
  assert.equal(car.year, '');
  assert.equal(car.title, 'Peugeot 2008 GT');
});

test('mantém preço, ano e quilómetros ligados ao anúncio correto', () => {
  const cars = extractInventory(inventory([
    advert(),
    advert({ title: 'Tesla Model Y', url: otherUrl, price: { value: '33990.00', currency: 'EUR' }, attributes: [
      { key: 'first_registration_year', value: '2024' }, { key: 'mileage', value: '7000' }
    ] })
  ]) + `<a href="${url}"><h2>Nome antigo</h2><p>Ano 2008 · 100 km · 99 990 EUR</p></a>`);
  assert.equal(cars.length, 2);
  assert.equal(cars[0].year, '2022');
  assert.equal(space(cars[0].price), '21 990 €');
  assert.equal(cars[1].year, '2024');
  assert.equal(space(cars[1].price), '33 990 €');
  assert.equal(space(cars[1].mileage), '7000 km');
});

test('aceita JSON-LD de Car em ItemList, preço decimal e data de modelo explícita', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: {
    '@type': 'Car', url, name: 'Peugeot e-2008 GT', vehicleModelDate: '2022-01-01',
    offers: { price: '21990.50', priceCurrency: 'EUR' }, mileageFromOdometer: { value: 92000, unitCode: 'KMT' }
  } }] })}</script>`;
  const [car] = extractInventory(html);
  assert.equal(car.year, '2022');
  assert.equal(space(car.price), '21 991 €');
  assert.equal(space(car.mileage), '92 000 km');
});

test('preço pt-PT com separadores é interpretado sem multiplicar por 100', () => {
  const [car] = extractInventory(inventory([advert({ price: { value: '21.990,00', currency: 'EUR' } })]));
  assert.equal(space(car.price), '21 990 €');
});

test('página de detalhe lê parametersDict e o preço bruto do anúncio', () => {
  const details = extractVehicleDetails(nextData({ advert: {
    title: 'Peugeot e-2008 GT', url, price: { value: '21990', currency: 'EUR' },
    parametersDict: {
      first_registration_year: { values: [{ value: '2022', label: '2022' }] },
      mileage: { values: [{ value: '92000', label: '92 000 km' }] },
      fuel_type: { values: [{ value: 'electric', label: 'Elétrico' }] }
    }, images: { photos: [{ url: 'https://images.example.test/detail.jpg' }] }
  } }), url);
  assert.equal(details.year, '2022');
  assert.equal(details.title, 'Peugeot e-2008 GT');
  assert.equal(space(details.mileage), '92 000 km');
  assert.equal(space(details.price), '21 990 €');
});

test('página redirecionada para outra viatura não contamina os detalhes pedidos', () => {
  const details = extractVehicleDetails(nextData({ advert: advert({ url: otherUrl }) }) + '<h1>Outro veículo</h1><p>Ano 2024 · 99 999 EUR</p>', url);
  assert.equal(details.url, url);
  assert.equal(details.year, '');
  assert.equal(details.price, '');
  assert.equal(details.title, '');
});

test('não aceita hosts semelhantes a Standvirtual nem transportes inseguros', () => {
  const urls = ['https://standvirtual.com.attacker.invalid/carros/anuncio/x', 'https://attacker.invalid/standvirtual.com/carros/anuncio/x', 'http://www.standvirtual.com/carros/anuncio/x', 'https://user@www.standvirtual.com/carros/anuncio/x'];
  for (const candidate of urls) {
    assert.deepEqual(extractInventory(inventory([advert({ url: candidate })]) + `<a href="${candidate}"><h2>Peugeot 2008</h2></a>`), []);
  }
});

test('JSON inválido usa fallback HTML e anos impossíveis não são apresentados', () => {
  const html = `<script id="__NEXT_DATA__">{invalid</script><a href="${url}"><h2>Peugeot 2008</h2><span>Ano 2099</span></a>`;
  const [car] = extractInventory(html);
  assert.equal(car.title, 'Peugeot 2008');
  assert.equal(car.year, '');
});
