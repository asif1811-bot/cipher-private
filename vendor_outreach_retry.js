require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Failed vendors from global send — retry these
const vendors = [
  { name: 'Far East Flora Singapore', email: 'orders@fareastflora.com', category: 'Personal Shopping', country: 'Singapore' },
  { name: 'Bloomback Singapore', email: 'hello@bloomback.sg', category: 'Personal Shopping', country: 'Singapore' },
  { name: 'Louis Vuitton Singapore', email: 'singapore@lv.com', category: 'Personal Shopping', country: 'Singapore' },
  { name: 'Indian Accent Delhi', email: 'reservations@indianaccent.com', category: 'Fine Dining', country: 'India' },
  { name: 'Indian Accent Mumbai', email: 'mumbai@indianaccent.com', category: 'Fine Dining', country: 'India' },
  { name: 'Masque Mumbai', email: 'reservations@masquerestaurant.com', category: 'Fine Dining', country: 'India' },
  { name: 'Wasabi by Morimoto Mumbai', email: 'wasabi@tajhotels.com', category: 'Fine Dining', country: 'India' },
  { name: 'Nobu Mumbai', email: 'mumbai@noburestaurants.com', category: 'Fine Dining', country: 'India' },
  { name: 'Tresind Mumbai', email: 'mumbai@tresind.com', category: 'Fine Dining', country: 'India' },
  { name: 'Dirty Apron Delhi', email: 'info@dirtyapron.in', category: 'Fine Dining', country: 'India' },
  { name: 'Lodi Garden Restaurant Delhi', email: 'info@lodienvironment.com', category: 'Fine Dining', country: 'India' },
  { name: 'Bukhara ITC Delhi', email: 'bukhara@itchotels.com', category: 'Fine Dining', country: 'India' },
  { name: 'Karavalli Bangalore', email: 'karavalli@gateway.tajhotels.com', category: 'Fine Dining', country: 'India' },
  { name: 'Zodiac Grill Mumbai', email: 'zodiacgrill@tajhotels.com', category: 'Fine Dining', country: 'India' },
  { name: 'Olive Bar Kitchen Mumbai', email: 'info@olivebarandkitchen.com', category: 'Fine Dining', country: 'India' },
  { name: 'Taj Mahal Palace Mumbai', email: 'tmhm.mumbai@tajhotels.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'The Oberoi Mumbai', email: 'reservations@oberoihotels.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'Four Seasons Mumbai', email: 'reservations.mumbai@fourseasons.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'ITC Maurya Delhi', email: 'itcmaurya@itchotels.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'The Leela Palace Delhi', email: 'delhi@theleela.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'Taj Palace Delhi', email: 'palace.delhi@tajhotels.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'The Oberoi New Delhi', email: 'reservations.newdelhi@oberoihotels.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'Taj West End Bangalore', email: 'westend.bangalore@tajhotels.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'The Leela Palace Bangalore', email: 'bangalore@theleela.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'ITC Grand Chola Chennai', email: 'grandchola@itchotels.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'Taj Falaknuma Palace Hyderabad', email: 'falaknuma.hyderabad@tajhotels.com', category: 'Luxury Hotel', country: 'India' },
  { name: 'Ola Corporate India', email: 'corporate@olacabs.com', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'BluSmart Corporate', email: 'corporate@blusmart.in', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'Meru Cabs Corporate', email: 'corporate@merucabs.com', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'Uber Business India', email: 'india.business@uber.com', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'Karya Cab Mumbai', email: 'info@karyacab.com', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'Imperial Cabs Delhi', email: 'info@imperialcabs.in', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'Club One Air India', email: 'charter@cluboneair.com', category: 'Private Aviation', country: 'India' },
  { name: 'Air Charter India', email: 'info@aircharterindia.com', category: 'Private Aviation', country: 'India' },
  { name: 'Jetworx India', email: 'charter@jetworx.in', category: 'Private Aviation', country: 'India' },
  { name: 'Heritage Aviation India', email: 'charter@heritageaviation.in', category: 'Private Aviation', country: 'India' },
  { name: 'FNP Ferns N Petals', email: 'corporate@fnp.com', category: 'Personal Shopping', country: 'India' },
  { name: 'FlowerAura India', email: 'support@floweraura.com', category: 'Personal Shopping', country: 'India' },
  { name: 'Interflora India', email: 'india@interflora.com', category: 'Personal Shopping', country: 'India' },
  { name: 'India Circus', email: 'hello@indiacircus.com', category: 'Personal Shopping', country: 'India' },
  { name: 'Taj Events Mumbai', email: 'events.tmhm@tajhotels.com', category: 'Events', country: 'India' },
  { name: 'ITC Hotels Events Delhi', email: 'events@itchotels.com', category: 'Events', country: 'India' },
  { name: 'Leela Events Bangalore', email: 'events.bangalore@theleela.com', category: 'Events', country: 'India' },
  { name: 'Alo Restaurant Toronto', email: 'info@alorestaurant.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Canoe Restaurant Toronto', email: 'reservations@canoerestaurant.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Buca Osteria Toronto', email: 'info@buca.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Actinolite Toronto', email: 'info@actinolite.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Edulis Toronto', email: 'reservations@edulisrestaurant.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Langdon Hall Cambridge', email: 'reservations@langdonhall.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Toqué Montreal', email: 'info@restaurant-toque.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Joe Beef Montreal', email: 'info@joebeef.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Le Vin Papillon Montreal', email: 'info@levinpapillon.com', category: 'Fine Dining', country: 'Canada' },
  { name: "Bishop's Vancouver", email: 'reservations@bishopsonline.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Chambar Vancouver', email: 'reservations@chambar.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Hawksworth Vancouver', email: 'reservations@hawksworthrestaurant.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Teatro Calgary', email: 'info@teatro.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'River Cafe Calgary', email: 'reservations@rivercafecalgary.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Four Seasons Toronto', email: 'reservations.toronto@fourseasons.com', category: 'Luxury Hotel', country: 'Canada' },
  { name: 'The Ritz-Carlton Toronto', email: 'rc.yyztg.reservations@ritzcarlton.com', category: 'Luxury Hotel', country: 'Canada' },
  { name: 'Shangri-La Toronto', email: 'tor@shangri-la.com', category: 'Luxury Hotel', country: 'Canada' },
  { name: 'Fairmont Royal York Toronto', email: 'royalyork@fairmont.com', category: 'Luxury Hotel', country: 'Canada' },
  { name: 'Four Seasons Vancouver', email: 'reservations.vancouver@fourseasons.com', category: 'Luxury Hotel', country: 'Canada' },
  { name: 'Fairmont Pacific Rim Vancouver', email: 'pacific.rim@fairmont.com', category: 'Luxury Hotel', country: 'Canada' },
  { name: 'Rosewood Hotel Georgia Vancouver', email: 'info@rosewoodhotels.com', category: 'Luxury Hotel', country: 'Canada' },
  { name: 'Fairmont Chateau Frontenac Quebec', email: 'frontenac@fairmont.com', category: 'Luxury Hotel', country: 'Canada' },
  { name: 'Ritz-Carlton Montreal', email: 'rc.yulrz.reservations@ritzcarlton.com', category: 'Luxury Hotel', country: 'Canada' },
  { name: 'Fairmont Banff Springs', email: 'banffsprings@fairmont.com', category: 'Luxury Hotel', country: 'Canada' },
  { name: 'Blacklane Canada', email: 'canada@blacklane.com', category: 'Luxury Chauffeur', country: 'Canada' },
  { name: 'Limo Toronto', email: 'info@limotoronto.ca', category: 'Luxury Chauffeur', country: 'Canada' },
  { name: 'ETS Limousine Vancouver', email: 'info@etslimousine.com', category: 'Luxury Chauffeur', country: 'Canada' },
  { name: 'Premiere Limousine Montreal', email: 'info@premierelimousine.ca', category: 'Luxury Chauffeur', country: 'Canada' },
  { name: 'Calgary Limo', email: 'info@calgarylimo.com', category: 'Luxury Chauffeur', country: 'Canada' },
  { name: 'Jettly Canada', email: 'canada@jettly.com', category: 'Private Aviation', country: 'Canada' },
  { name: 'Chartright Air Toronto', email: 'info@chartright.com', category: 'Private Aviation', country: 'Canada' },
  { name: 'Skyservice Aviation', email: 'info@skyservice.com', category: 'Private Aviation', country: 'Canada' },
  { name: 'Pacific Coastal Airlines Charter', email: 'charters@pacificcoastal.com', category: 'Private Aviation', country: 'Canada' },
  { name: 'Bloom Flowers Toronto', email: 'orders@bloomflowers.ca', category: 'Personal Shopping', country: 'Canada' },
  { name: 'Flowers by Cina Vancouver', email: 'info@flowersbycina.com', category: 'Personal Shopping', country: 'Canada' },
  { name: 'Au Jardin Montreal Florist', email: 'info@aujardin.ca', category: 'Personal Shopping', country: 'Canada' },
  { name: 'Holt Renfrew Toronto', email: 'toronto@holtrenfrew.com', category: 'Personal Shopping', country: 'Canada' },
  { name: 'Fairmont Events Toronto', email: 'events.royalyork@fairmont.com', category: 'Events', country: 'Canada' },
  { name: 'Four Seasons Events Vancouver', email: 'events.vancouver@fourseasons.com', category: 'Events', country: 'Canada' },
  { name: 'Palais des Congrès Montreal', email: 'events@congresmtl.com', category: 'Events', country: 'Canada' },
  { name: 'Le Bernardin New York', email: 'reservations@le-bernardin.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Per Se New York', email: 'reservations@perseny.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Eleven Madison Park NYC', email: 'reservations@elevenmadisonpark.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Daniel NYC', email: 'reservations@danielnyc.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Masa New York', email: 'reservations@masanyc.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Nobu New York', email: 'newyork@noburestaurants.com', category: 'Fine Dining', country: 'USA' },
  { name: 'The French Laundry California', email: 'reservations@frenchlaundry.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Nobu Los Angeles', email: 'losangeles@noburestaurants.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Spago Beverly Hills', email: 'reservations@wolfgangpuck.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Providence Los Angeles', email: 'info@providencela.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Nobu Miami', email: 'miami@noburestaurants.com', category: 'Fine Dining', country: 'USA' },
  { name: "Joe's Stone Crab Miami", email: 'reservations@joesstonecrab.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Carbone Miami', email: 'miami@carbonereservations.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Alinea Chicago', email: 'reservations@alineagroup.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Smyth Chicago', email: 'reservations@smythandtheloyalist.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Boka Chicago', email: 'reservations@bokachicago.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Nobu Houston', email: 'houston@noburestaurants.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Uchiko Austin', email: 'reservations@uchiko.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Quince San Francisco', email: 'reservations@quincerestaurant.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Saison San Francisco', email: 'reservations@saisonsf.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Joël Robuchon Las Vegas', email: 'mgm.joelrobuchon@mgmresorts.com', category: 'Fine Dining', country: 'USA' },
  { name: 'Guy Savoy Las Vegas', email: 'guysavoy@caesars.com', category: 'Fine Dining', country: 'USA' },
  { name: 'The Plaza New York', email: 'reservations@theplazany.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Four Seasons New York', email: 'reservations.nyc@fourseasons.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'The Ritz-Carlton New York', email: 'rc.nycrz.reservations@ritzcarlton.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Aman New York', email: 'amanny@aman.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'The Mark Hotel New York', email: 'reservations@themarkhotel.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Beverly Wilshire Four Seasons', email: 'bwfh.reservations@fourseasons.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Chateau Marmont LA', email: 'reservations@chateaumarmont.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'The Biltmore Los Angeles', email: 'reservations@thebiltmorela.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'The Edition Miami Beach', email: 'miami@editionhotels.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Faena Hotel Miami Beach', email: 'reservations@faena.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'The St Regis Chicago', email: 'stregis.chicago@stregis.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Four Seasons Chicago', email: 'reservations.chi@fourseasons.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Post Oak Hotel Houston', email: 'reservations@thepostoakhotel.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'The Rosewood Mansion Dallas', email: 'reservations@rosewoodhotels.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Four Seasons San Francisco', email: 'reservations.sfo@fourseasons.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Bellagio Las Vegas', email: 'reservations@bellagio.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Wynn Las Vegas', email: 'reservations@wynnlasvegas.com', category: 'Luxury Hotel', country: 'USA' },
  { name: 'Blacklane USA', email: 'usa@blacklane.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Carey International USA', email: 'info@carey.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Manhattan Limo NYC', email: 'info@manhattanlimo.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Uber for Business USA', email: 'business@uber.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'LA Limousines', email: 'info@lalimousines.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Miami Limo Service', email: 'info@miamilimoservice.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Chicago Limo', email: 'info@chicagolimo.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Jettly USA', email: 'usa@jettly.com', category: 'Private Aviation', country: 'USA' },
  { name: 'NetJets USA', email: 'info@netjets.com', category: 'Private Aviation', country: 'USA' },
  { name: 'Wheels Up USA', email: 'info@wheelsup.com', category: 'Private Aviation', country: 'USA' },
  { name: 'VistaJet USA', email: 'usa@vistajet.com', category: 'Private Aviation', country: 'USA' },
  { name: 'Flexjet USA', email: 'info@flexjet.com', category: 'Private Aviation', country: 'USA' },
  { name: 'Air Partner USA', email: 'usa@airpartner.com', category: 'Private Aviation', country: 'USA' },
  { name: 'Shoreside Concierge Miami', email: 'charter@shoresideconcierge.com', category: 'Yacht & Marine', country: 'USA' },
  { name: 'Dream Yacht Charter USA', email: 'usa@dreamyachtcharter.com', category: 'Yacht & Marine', country: 'USA' },
  { name: 'Burgess Yachts USA', email: 'usa@burgessmarine.com', category: 'Yacht & Marine', country: 'USA' },
  { name: 'Northrop & Johnson USA', email: 'info@njcharters.com', category: 'Yacht & Marine', country: 'USA' },
  { name: '1-800-Flowers USA', email: 'corporate@1800flowers.com', category: 'Personal Shopping', country: 'USA' },
  { name: 'FTD Flowers USA', email: 'corporate@ftd.com', category: 'Personal Shopping', country: 'USA' },
  { name: 'Saks Fifth Avenue Personal Shopping', email: 'personalshop@saks.com', category: 'Personal Shopping', country: 'USA' },
  { name: 'Bergdorf Goodman NYC', email: 'personalshop@bergdorfgoodman.com', category: 'Personal Shopping', country: 'USA' },
  { name: 'Neiman Marcus Personal Shopping', email: 'personalshop@neimanmarcus.com', category: 'Personal Shopping', country: 'USA' },
  { name: 'Cipriani Events New York', email: 'events@cipriani.com', category: 'Events', country: 'USA' },
  { name: 'The Plaza Events NYC', email: 'catering@theplazany.com', category: 'Events', country: 'USA' },
  { name: 'Four Seasons Events Chicago', email: 'events.chi@fourseasons.com', category: 'Events', country: 'USA' },
  { name: 'Wynn Events Las Vegas', email: 'events@wynnlasvegas.com', category: 'Events', country: 'USA' },
  { name: 'Majestic Security USA', email: 'ops@majesticsecurity.com', category: 'Security', country: 'USA' },
  { name: 'Allied Universal USA', email: 'info@aus.com', category: 'Security', country: 'USA' },
  { name: 'Pinkerton USA', email: 'info@pinkerton.com', category: 'Security', country: 'USA' },
  { name: 'Exhale Spa USA', email: 'info@exhalespa.com', category: 'Wellness & Spa', country: 'USA' },
  { name: 'Bliss Spa USA', email: 'reservations@blissworld.com', category: 'Wellness & Spa', country: 'USA' },
  { name: 'Four Seasons Spa NYC', email: 'spa.nyc@fourseasons.com', category: 'Wellness & Spa', country: 'USA' },
  { name: 'The Ritz London', email: 'reservations@theritzlondon.com', category: 'Luxury Hotel', country: 'UK' },
  { name: "Claridge's London", email: 'reservations@claridges.co.uk', category: 'Luxury Hotel', country: 'UK' },
  { name: 'The Savoy London', email: 'reservations@fairmont.com', category: 'Luxury Hotel', country: 'UK' },
  { name: 'Nobu London', email: 'london@noburestaurants.com', category: 'Fine Dining', country: 'UK' },
  { name: 'Restaurant Gordon Ramsay', email: 'reservations@gordonramsay.com', category: 'Fine Dining', country: 'UK' },
  { name: 'The Fat Duck Bray', email: 'reservations@thefatduck.co.uk', category: 'Fine Dining', country: 'UK' },
  { name: 'Blacklane UK', email: 'uk@blacklane.com', category: 'Luxury Chauffeur', country: 'UK' },
  { name: 'Rolls Royce Hire London', email: 'info@rollsroycehire.london', category: 'Luxury Chauffeur', country: 'UK' },
  { name: 'Air Charter Service UK', email: 'uk@aircharterservice.com', category: 'Private Aviation', country: 'UK' },
  { name: 'Moyses Stevens Flowers London', email: 'info@moysesstevenss.co.uk', category: 'Personal Shopping', country: 'UK' },
];

function buildEmail(v) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f0eb;font-family:Arial,sans-serif">
<div style="max-width:580px;margin:40px auto;background:#fff;border:1px solid #e2dbd3;border-radius:8px;overflow:hidden">
  <div style="background:#1a1612;padding:28px 32px;text-align:center">
    <div style="font-size:10px;letter-spacing:6px;color:#c9a96e;text-transform:uppercase">Consiere</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px">Your life, handled.</div>
  </div>
  <div style="padding:36px 32px">
    <p style="font-size:14px;color:#1a1612;font-weight:600;margin:0 0 20px">Dear ${v.name} Team,</p>
    <p style="font-size:13px;color:#44403c;line-height:1.9;margin:0 0 16px">My name is Asif, founder of <strong>Consiere</strong> — a global personal AI concierge service operating across Australia, UAE, Singapore, India, Canada and the USA.</p>
    <p style="font-size:13px;color:#44403c;line-height:1.9;margin:0 0 16px">Our members send one message to Alina, our AI concierge, and she handles everything. When a member needs ${v.category} services in ${v.country}, we connect them with partners like you.</p>
    <div style="background:#faf7f3;border:1px solid #e2dbd3;border-radius:6px;padding:20px 24px;margin:20px 0">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a96e;margin-bottom:12px">Partnership terms</div>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>Zero upfront cost</strong> — free to join. 10% commission on completed bookings only.</p>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>Qualified leads</strong> — every client has confirmed their request. No tyre-kickers.</p>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>Fast payment</strong> — we pay you within 2 business days of receiving client payment.</p>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>No lock-in</strong> — accept or decline any request. No minimums.</p>
    </div>
    <div style="border-left:3px solid #c9a96e;padding:14px 18px;margin:20px 0;background:#fffdf9">
      <p style="font-size:13px;color:#44403c;line-height:1.9;margin:0"><strong>A note from our founder:</strong><br>We are early stage — your first client may take a little time. But we are committed to building the world's leading concierge platform. <strong>When we send you a client, please give them priority.</strong> Your reputation and ours grow together.</p>
    </div>
    <div style="text-align:center;margin:28px 0">
      <a href="https://consiere.com.au/vendors" style="display:inline-block;padding:14px 40px;background:#1a1612;color:#fff;text-decoration:none;font-size:13px;font-weight:600;border-radius:4px">Register as a Vendor Partner &rarr;</a>
    </div>
    <p style="font-size:13px;color:#1a1612;margin:24px 0 2px">Warm regards,</p>
    <p style="font-size:14px;color:#1a1612;font-weight:600;margin:0">Asif — Founder, Consiere</p>
    <p style="font-size:12px;color:#c9a96e;margin:4px 0">hello@consiere.com.au &middot; consiere.com.au</p>
  </div>
  <div style="background:#faf7f3;padding:14px 32px;border-top:1px solid #e2dbd3;text-align:center">
    <p style="font-size:10px;color:#c4bdb6;margin:0">To opt out reply "unsubscribe" &middot; Consiere &middot; Sydney, Australia</p>
  </div>
</div></body></html>`;
}

async function send() {
  console.log(`Sending to ${vendors.length} vendors...\n`);
  let sent=0, failed=0;
  for (const v of vendors) {
    await new Promise(r => setTimeout(r, 600));
    try {
      const r = await resend.emails.send({
        from: 'Asif at Consiere <hello@consiere.com.au>',
        to: v.email,
        replyTo: 'hello@consiere.com.au',
        subject: 'Partnership invitation — Consiere global concierge network',
        html: buildEmail(v),
      });
      if (r.error) { console.log(`FAILED  [${v.country}] ${v.name}: ${r.error.message}`); failed++; }
      else { console.log(`SENT    [${v.country}] ${v.name}`); sent++; }
    } catch(e) { console.log(`ERROR   [${v.country}] ${v.name}: ${e.message}`); failed++; }
  }
  console.log(`\n═══════════════════`);
  console.log(`Sent:   ${sent}`);
  console.log(`Failed: ${failed}`);
}
send().catch(console.error);
