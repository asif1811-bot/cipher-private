require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const vendors = [

  // ═══════════════════════════════════════════════════════
  // 🇦🇪 UAE — DUBAI & ABU DHABI
  // ═══════════════════════════════════════════════════════

  // Dining UAE
  { name: 'Nobu Dubai', email: 'reservations.dubai@noburestaurants.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Zuma Dubai', email: 'dubai@zumarestaurant.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Nusr-Et Dubai', email: 'dubai@nusr-et.com.tr', category: 'Fine Dining', country: 'UAE' },
  { name: 'Torno Subito Dubai', email: 'info@tornosubito.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Ossiano Atlantis', email: 'ossiano@atlantisthepalm.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Pai Thai Jumeirah', email: 'paithai@jumeirah.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'La Petite Maison Dubai', email: 'dubai@lapetitemaisondubai.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Hakkasan Dubai', email: 'dubai@hakkasan.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Amazonico Dubai', email: 'dubai@amazonicorestaurant.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Coya Dubai', email: 'reservations@coyadubai.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Cipriani Dubai', email: 'dubai@cipriani.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Buddha-Bar Dubai', email: 'dubai@buddhabar.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Rockfish Dubai', email: 'info@rockfishdubai.com', category: 'Fine Dining', country: 'UAE' },
  { name: 'Bagatelle Dubai', email: 'dubai@bagatelle.com', category: 'Fine Dining', country: 'UAE' },

  // Hotels UAE
  { name: 'Burj Al Arab', email: 'BAA.reservations@jumeirah.com', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'Atlantis The Palm', email: 'reservations@atlantisthepalm.com', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'One&Only The Palm', email: 'thepalm@oneandonlyresorts.com', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'Four Seasons Dubai DIFC', email: 'reservations.dxbdf@fourseasons.com', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'Jumeirah Al Naseem', email: 'JAN.reservations@jumeirah.com', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'Armani Hotel Dubai', email: 'armanihoteldubai@armanihotels.com', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'Address Downtown Dubai', email: 'reservations@addresshotels.com', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'Palazzo Versace Dubai', email: 'info@palazzoversace.ae', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'Bulgari Resort Dubai', email: 'dubai@bulgarihotels.com', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'St Regis Dubai', email: 'stregis.dubai@stregis.com', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'Emirates Palace Abu Dhabi', email: 'reservations.emiratespalace@mandarinoriental.com', category: 'Luxury Hotel', country: 'UAE' },
  { name: 'Yas Island Hotels', email: 'reservations@yashotel.ae', category: 'Luxury Hotel', country: 'UAE' },

  // Transport UAE
  { name: 'Careem Executive Dubai', email: 'corporate@careem.com', category: 'Luxury Chauffeur', country: 'UAE' },
  { name: 'Blacklane UAE', email: 'uae@blacklane.com', category: 'Luxury Chauffeur', country: 'UAE' },
  { name: 'Emirates Limo', email: 'corporate@emirateslimo.com', category: 'Luxury Chauffeur', country: 'UAE' },
  { name: 'Driven Dubai', email: 'info@driven.ae', category: 'Luxury Chauffeur', country: 'UAE' },
  { name: 'VIP Limo Dubai', email: 'info@viplimo.ae', category: 'Luxury Chauffeur', country: 'UAE' },
  { name: 'Royal Limo Dubai', email: 'info@royallimo.ae', category: 'Luxury Chauffeur', country: 'UAE' },

  // Aviation UAE
  { name: 'DC Aviation Al Futtaim', email: 'charter@dc-aviation.ae', category: 'Private Aviation', country: 'UAE' },
  { name: 'ExecuJet Dubai', email: 'dubai@execujet.com', category: 'Private Aviation', country: 'UAE' },
  { name: 'Jetex Dubai', email: 'dubai@jetex.com', category: 'Private Aviation', country: 'UAE' },
  { name: 'Empire Aviation Dubai', email: 'charter@empaviation.com', category: 'Private Aviation', country: 'UAE' },
  { name: 'Royal Jet Abu Dhabi', email: 'charter@royaljet.com', category: 'Private Aviation', country: 'UAE' },

  // Yacht UAE
  { name: 'Dubai Marina Yacht Club', email: 'info@dubaimarinayachtclub.ae', category: 'Yacht & Marine', country: 'UAE' },
  { name: 'Cozmo Yachts Dubai', email: 'info@cozmoyachts.com', category: 'Yacht & Marine', country: 'UAE' },
  { name: 'Xclusive Yachts Dubai', email: 'info@xclusiveyachts.com', category: 'Yacht & Marine', country: 'UAE' },
  { name: 'Gulf Leisure Dubai', email: 'info@gulfleisuremarine.com', category: 'Yacht & Marine', country: 'UAE' },

  // Events UAE
  { name: 'Madinat Jumeirah Events', email: 'mjf.events@jumeirah.com', category: 'Events', country: 'UAE' },
  { name: 'Dubai World Trade Centre', email: 'events@dwtc.com', category: 'Events', country: 'UAE' },
  { name: 'Four Seasons Events Dubai', email: 'events.dxbdf@fourseasons.com', category: 'Events', country: 'UAE' },

  // Shopping UAE
  { name: 'Royal Flowers UAE', email: 'orders@royalflowersuae.com', category: 'Personal Shopping', country: 'UAE' },
  { name: 'Bloomingdales Dubai', email: 'dubai@bloomingdales.com', category: 'Personal Shopping', country: 'UAE' },
  { name: 'Harvey Nichols Dubai', email: 'dubai@harveynichols.com', category: 'Personal Shopping', country: 'UAE' },

  // ═══════════════════════════════════════════════════════
  // 🇸🇬 SINGAPORE
  // ═══════════════════════════════════════════════════════

  // Dining Singapore
  { name: 'Odette Singapore', email: 'reservations@odetterestaurant.com', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Les Amis Singapore', email: 'lesamis@lesamis.com.sg', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Burnt Ends Singapore', email: 'reservations@burntends.com.sg', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Jaan by Kirk Westaway', email: 'info@jaan.com.sg', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Waku Ghin Singapore', email: 'wakughin@marinabaysands.com', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Cut by Wolfgang Puck', email: 'cut.singapore@marinabaysands.com', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Tablescape Singapore', email: 'tablescape@grandparksingapore.com', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Alma by Juan Amador', email: 'reservations@almabyjuanamador.com', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Zuma Singapore', email: 'singapore@zumarestaurant.com', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Nobu Singapore', email: 'singapore@noburestaurants.com', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Au Jardin Singapore', email: 'info@aujardin.com.sg', category: 'Fine Dining', country: 'Singapore' },
  { name: 'Coriander Leaf Singapore', email: 'info@corianderleaf.com', category: 'Fine Dining', country: 'Singapore' },

  // Hotels Singapore
  { name: 'Raffles Hotel Singapore', email: 'singapore@raffles.com', category: 'Luxury Hotel', country: 'Singapore' },
  { name: 'Marina Bay Sands', email: 'singapore@marinabaysands.com', category: 'Luxury Hotel', country: 'Singapore' },
  { name: 'The Fullerton Hotel Singapore', email: 'enquiry@fullertonhotel.com', category: 'Luxury Hotel', country: 'Singapore' },
  { name: 'Four Seasons Singapore', email: 'reservations.sin@fourseasons.com', category: 'Luxury Hotel', country: 'Singapore' },
  { name: 'Capella Singapore', email: 'reservations.singapore@capellahotels.com', category: 'Luxury Hotel', country: 'Singapore' },
  { name: 'The St Regis Singapore', email: 'stregis.singapore@stregis.com', category: 'Luxury Hotel', country: 'Singapore' },
  { name: 'Shangri-La Singapore', email: 'sls@shangri-la.com', category: 'Luxury Hotel', country: 'Singapore' },
  { name: 'Mandarin Oriental Singapore', email: 'mosin-reservations@mohg.com', category: 'Luxury Hotel', country: 'Singapore' },
  { name: 'The Ritz-Carlton Millenia', email: 'rc.sinrz.reservations@ritzcarlton.com', category: 'Luxury Hotel', country: 'Singapore' },

  // Transport Singapore
  { name: 'Blacklane Singapore', email: 'singapore@blacklane.com', category: 'Luxury Chauffeur', country: 'Singapore' },
  { name: 'SMRT Corporate', email: 'corporate@smrt.com.sg', category: 'Luxury Chauffeur', country: 'Singapore' },
  { name: 'Premier Taxis Corporate', email: 'corporate@premiertaxis.com.sg', category: 'Luxury Chauffeur', country: 'Singapore' },
  { name: 'Grab Corporate Singapore', email: 'corporate@grab.com', category: 'Luxury Chauffeur', country: 'Singapore' },
  { name: 'Trans-Cab Corporate', email: 'corporate@transcab.com.sg', category: 'Luxury Chauffeur', country: 'Singapore' },

  // Aviation Singapore
  { name: 'ExecuJet Singapore', email: 'singapore@execujet.com', category: 'Private Aviation', country: 'Singapore' },
  { name: 'Jetfly Singapore', email: 'singapore@jetfly.com', category: 'Private Aviation', country: 'Singapore' },
  { name: 'Asian Sky Group', email: 'info@asianskygroup.com', category: 'Private Aviation', country: 'Singapore' },

  // Events Singapore
  { name: 'Marina Bay Sands Events', email: 'events@marinabaysands.com', category: 'Events', country: 'Singapore' },
  { name: 'Capella Singapore Events', email: 'events.singapore@capellahotels.com', category: 'Events', country: 'Singapore' },
  { name: 'Raffles Singapore Events', email: 'events.singapore@raffles.com', category: 'Events', country: 'Singapore' },
  { name: 'Sands Expo Singapore', email: 'meetings@marinabaysands.com', category: 'Events', country: 'Singapore' },

  // Shopping Singapore
  { name: 'Far East Flora Singapore', email: 'orders@fareastflora.com', category: 'Personal Shopping', country: 'Singapore' },
  { name: 'Bloomback Singapore', email: 'hello@bloomback.sg', category: 'Personal Shopping', country: 'Singapore' },
  { name: 'Louis Vuitton Singapore', email: 'singapore@lv.com', category: 'Personal Shopping', country: 'Singapore' },

  // ═══════════════════════════════════════════════════════
  // 🇮🇳 INDIA — MUMBAI, DELHI, BANGALORE, CHENNAI
  // ═══════════════════════════════════════════════════════

  // Dining India
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

  // Hotels India
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

  // Transport India
  { name: 'Ola Corporate India', email: 'corporate@olacabs.com', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'BluSmart Corporate', email: 'corporate@blusmart.in', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'Meru Cabs Corporate', email: 'corporate@merucabs.com', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'Uber Business India', email: 'india.business@uber.com', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'Karya Cab Mumbai', email: 'info@karyacab.com', category: 'Luxury Chauffeur', country: 'India' },
  { name: 'Imperial Cabs Delhi', email: 'info@imperialcabs.in', category: 'Luxury Chauffeur', country: 'India' },

  // Aviation India
  { name: 'Club One Air India', email: 'charter@cluboneair.com', category: 'Private Aviation', country: 'India' },
  { name: 'Air Charter India', email: 'info@aircharterindia.com', category: 'Private Aviation', country: 'India' },
  { name: 'Jetworx India', email: 'charter@jetworx.in', category: 'Private Aviation', country: 'India' },
  { name: 'Heritage Aviation India', email: 'charter@heritageaviation.in', category: 'Private Aviation', country: 'India' },

  // Shopping India
  { name: 'FNP Ferns N Petals', email: 'corporate@fnp.com', category: 'Personal Shopping', country: 'India' },
  { name: 'FlowerAura India', email: 'support@floweraura.com', category: 'Personal Shopping', country: 'India' },
  { name: 'Interflora India', email: 'india@interflora.com', category: 'Personal Shopping', country: 'India' },
  { name: 'India Circus', email: 'hello@indiacircus.com', category: 'Personal Shopping', country: 'India' },

  // Events India
  { name: 'Taj Events Mumbai', email: 'events.tmhm@tajhotels.com', category: 'Events', country: 'India' },
  { name: 'ITC Hotels Events Delhi', email: 'events@itchotels.com', category: 'Events', country: 'India' },
  { name: 'Leela Events Bangalore', email: 'events.bangalore@theleela.com', category: 'Events', country: 'India' },

  // ═══════════════════════════════════════════════════════
  // 🇨🇦 CANADA — TORONTO, VANCOUVER, MONTREAL, CALGARY
  // ═══════════════════════════════════════════════════════

  // Dining Canada
  { name: 'Alo Restaurant Toronto', email: 'info@alorestaurant.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Canoe Restaurant Toronto', email: 'reservations@canoerestaurant.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Buca Osteria Toronto', email: 'info@buca.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Actinolite Toronto', email: 'info@actinolite.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Edulis Toronto', email: 'reservations@edulisrestaurant.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Langdon Hall Cambridge', email: 'reservations@langdonhall.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Toqué Montreal', email: 'info@restaurant-toque.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Joe Beef Montreal', email: 'info@joebeef.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'Le Vin Papillon Montreal', email: 'info@levinpapillon.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Bishop\'s Vancouver', email: 'reservations@bishopsonline.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Chambar Vancouver', email: 'reservations@chambar.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Hawksworth Vancouver', email: 'reservations@hawksworthrestaurant.com', category: 'Fine Dining', country: 'Canada' },
  { name: 'Teatro Calgary', email: 'info@teatro.ca', category: 'Fine Dining', country: 'Canada' },
  { name: 'River Cafe Calgary', email: 'reservations@rivercafecalgary.com', category: 'Fine Dining', country: 'Canada' },

  // Hotels Canada
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

  // Transport Canada
  { name: 'Blacklane Canada', email: 'canada@blacklane.com', category: 'Luxury Chauffeur', country: 'Canada' },
  { name: 'Limo Toronto', email: 'info@limotoronto.ca', category: 'Luxury Chauffeur', country: 'Canada' },
  { name: 'ETS Limousine Vancouver', email: 'info@etslimousine.com', category: 'Luxury Chauffeur', country: 'Canada' },
  { name: 'Premiere Limousine Montreal', email: 'info@premierelimousine.ca', category: 'Luxury Chauffeur', country: 'Canada' },
  { name: 'Calgary Limo', email: 'info@calgarylimo.com', category: 'Luxury Chauffeur', country: 'Canada' },

  // Aviation Canada
  { name: 'Jettly Canada', email: 'canada@jettly.com', category: 'Private Aviation', country: 'Canada' },
  { name: 'Chartright Air Toronto', email: 'info@chartright.com', category: 'Private Aviation', country: 'Canada' },
  { name: 'Skyservice Aviation', email: 'info@skyservice.com', category: 'Private Aviation', country: 'Canada' },
  { name: 'Pacific Coastal Airlines Charter', email: 'charters@pacificcoastal.com', category: 'Private Aviation', country: 'Canada' },

  // Shopping Canada
  { name: 'Bloom Flowers Toronto', email: 'orders@bloomflowers.ca', category: 'Personal Shopping', country: 'Canada' },
  { name: 'Flowers by Cina Vancouver', email: 'info@flowersbycina.com', category: 'Personal Shopping', country: 'Canada' },
  { name: 'Au Jardin Montreal Florist', email: 'info@aujardin.ca', category: 'Personal Shopping', country: 'Canada' },
  { name: 'Holt Renfrew Toronto', email: 'toronto@holtrenfrew.com', category: 'Personal Shopping', country: 'Canada' },

  // Events Canada
  { name: 'Fairmont Events Toronto', email: 'events.royalyork@fairmont.com', category: 'Events', country: 'Canada' },
  { name: 'Four Seasons Events Vancouver', email: 'events.vancouver@fourseasons.com', category: 'Events', country: 'Canada' },
  { name: 'Palais des Congrès Montreal', email: 'events@congresmtl.com', category: 'Events', country: 'Canada' },

  // ═══════════════════════════════════════════════════════
  // 🇺🇸 USA — NEW YORK, LOS ANGELES, MIAMI, CHICAGO, HOUSTON, DALLAS, SF, VEGAS
  // ═══════════════════════════════════════════════════════

  // Dining USA
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
  { name: 'Joe\'s Stone Crab Miami', email: 'reservations@joesstonecrab.com', category: 'Fine Dining', country: 'USA' },
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

  // Hotels USA
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

  // Transport USA
  { name: 'Blacklane USA', email: 'usa@blacklane.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Carey International USA', email: 'info@carey.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Manhattan Limo NYC', email: 'info@manhattanlimo.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Uber for Business USA', email: 'business@uber.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'LA Limousines', email: 'info@lalimousines.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Miami Limo Service', email: 'info@miamilimoservice.com', category: 'Luxury Chauffeur', country: 'USA' },
  { name: 'Chicago Limo', email: 'info@chicagolimo.com', category: 'Luxury Chauffeur', country: 'USA' },

  // Aviation USA
  { name: 'Jettly USA', email: 'usa@jettly.com', category: 'Private Aviation', country: 'USA' },
  { name: 'NetJets USA', email: 'info@netjets.com', category: 'Private Aviation', country: 'USA' },
  { name: 'Wheels Up USA', email: 'info@wheelsup.com', category: 'Private Aviation', country: 'USA' },
  { name: 'VistaJet USA', email: 'usa@vistajet.com', category: 'Private Aviation', country: 'USA' },
  { name: 'Flexjet USA', email: 'info@flexjet.com', category: 'Private Aviation', country: 'USA' },
  { name: 'Air Partner USA', email: 'usa@airpartner.com', category: 'Private Aviation', country: 'USA' },

  // Yacht USA
  { name: 'Shoreside Concierge Miami', email: 'charter@shoresideconcierge.com', category: 'Yacht & Marine', country: 'USA' },
  { name: 'Dream Yacht Charter USA', email: 'usa@dreamyachtcharter.com', category: 'Yacht & Marine', country: 'USA' },
  { name: 'Burgess Yachts USA', email: 'usa@burgessmarine.com', category: 'Yacht & Marine', country: 'USA' },
  { name: 'Northrop & Johnson USA', email: 'info@njcharters.com', category: 'Yacht & Marine', country: 'USA' },

  // Shopping USA
  { name: '1-800-Flowers USA', email: 'corporate@1800flowers.com', category: 'Personal Shopping', country: 'USA' },
  { name: 'FTD Flowers USA', email: 'corporate@ftd.com', category: 'Personal Shopping', country: 'USA' },
  { name: 'Saks Fifth Avenue Personal Shopping', email: 'personalshop@saks.com', category: 'Personal Shopping', country: 'USA' },
  { name: 'Bergdorf Goodman NYC', email: 'personalshop@bergdorfgoodman.com', category: 'Personal Shopping', country: 'USA' },
  { name: 'Neiman Marcus Personal Shopping', email: 'personalshop@neimanmarcus.com', category: 'Personal Shopping', country: 'USA' },

  // Events USA
  { name: 'Cipriani Events New York', email: 'events@cipriani.com', category: 'Events', country: 'USA' },
  { name: 'The Plaza Events NYC', email: 'catering@theplazany.com', category: 'Events', country: 'USA' },
  { name: 'Four Seasons Events Chicago', email: 'events.chi@fourseasons.com', category: 'Events', country: 'USA' },
  { name: 'Wynn Events Las Vegas', email: 'events@wynnlasvegas.com', category: 'Events', country: 'USA' },

  // Security USA
  { name: 'Majestic Security USA', email: 'ops@majesticsecurity.com', category: 'Security', country: 'USA' },
  { name: 'Allied Universal USA', email: 'info@aus.com', category: 'Security', country: 'USA' },
  { name: 'Pinkerton USA', email: 'info@pinkerton.com', category: 'Security', country: 'USA' },

  // Wellness USA
  { name: 'Exhale Spa USA', email: 'info@exhalespa.com', category: 'Wellness & Spa', country: 'USA' },
  { name: 'Bliss Spa USA', email: 'reservations@blissworld.com', category: 'Wellness & Spa', country: 'USA' },
  { name: 'Four Seasons Spa NYC', email: 'spa.nyc@fourseasons.com', category: 'Wellness & Spa', country: 'USA' },

  // ═══════════════════════════════════════════════════════
  // 🇬🇧 UK — LONDON (BONUS MARKET)
  // ═══════════════════════════════════════════════════════
  { name: 'The Ritz London', email: 'reservations@theritzlondon.com', category: 'Luxury Hotel', country: 'UK' },
  { name: 'Claridge\'s London', email: 'reservations@claridges.co.uk', category: 'Luxury Hotel', country: 'UK' },
  { name: 'The Savoy London', email: 'reservations@fairmont.com', category: 'Luxury Hotel', country: 'UK' },
  { name: 'Nobu London', email: 'london@noburestaurants.com', category: 'Fine Dining', country: 'UK' },
  { name: 'Restaurant Gordon Ramsay', email: 'reservations@gordonramsay.com', category: 'Fine Dining', country: 'UK' },
  { name: 'The Fat Duck Bray', email: 'reservations@thefatduck.co.uk', category: 'Fine Dining', country: 'UK' },
  { name: 'Blacklane UK', email: 'uk@blacklane.com', category: 'Luxury Chauffeur', country: 'UK' },
  { name: 'Rolls Royce Hire London', email: 'info@rollsroycehire.london', category: 'Luxury Chauffeur', country: 'UK' },
  { name: 'Air Charter Service UK', email: 'uk@aircharterservice.com', category: 'Private Aviation', country: 'UK' },
  { name: 'Moyses Stevens Flowers London', email: 'info@moysesstevenss.co.uk', category: 'Personal Shopping', country: 'UK' },
];

function buildEmail(vendor) {
  const countryNote = vendor.country !== 'Australia'
    ? `We currently operate across Australia, UAE, Singapore, India, Canada and the USA — and ${vendor.country} is a key part of our global network.`
    : 'We are launching across Australia with rapid global expansion underway.';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f0eb;font-family:Arial,sans-serif">
<div style="max-width:580px;margin:40px auto;background:#fff;border:1px solid #e2dbd3;border-radius:8px;overflow:hidden">
  <div style="background:#1a1612;padding:28px 32px;text-align:center">
    <div style="font-size:10px;letter-spacing:6px;color:#c9a96e;text-transform:uppercase;font-family:Georgia,serif">Consiere</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px">Your life, handled.</div>
  </div>
  <div style="padding:36px 32px">
    <p style="font-size:14px;color:#1a1612;font-weight:600;margin:0 0 20px">Dear ${vendor.name} Team,</p>
    <p style="font-size:13px;color:#44403c;line-height:1.9;margin:0 0 16px">My name is Asif, founder of <strong>Consiere</strong> — a global personal AI concierge service. ${countryNote}</p>
    <p style="font-size:13px;color:#44403c;line-height:1.9;margin:0 0 16px">Our members send one message to Alina, our AI concierge, and she handles everything — restaurant bookings, transport, hotels, shopping, home services and more. When a member needs ${vendor.category} services in ${vendor.country}, we connect them with partners like you.</p>
    <div style="background:#faf7f3;border:1px solid #e2dbd3;border-radius:6px;padding:20px 24px;margin:20px 0">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a96e;margin-bottom:12px">How the partnership works</div>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>Zero upfront cost</strong> — free to join. We charge 10% commission on completed bookings only.</p>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>Qualified leads only</strong> — every client has confirmed their request. No tyre-kickers.</p>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>Fast payment</strong> — client pays us, we pay you within 2 business days. Simple.</p>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>You stay in control</strong> — accept or decline any request. No lock-in, no minimums.</p>
    </div>
    <div style="border-left:3px solid #c9a96e;padding:14px 18px;margin:20px 0;background:#fffdf9">
      <p style="font-size:13px;color:#44403c;line-height:1.9;margin:0"><strong>A candid note from our founder:</strong><br>We are in our early stages and it may take a little time before your first Consiere client arrives. But we are building this properly across 6 countries with a goal to become the world's leading personal concierge platform. To achieve that we need partners we can trust — partners who give our members priority when we send them.</p>
      <p style="font-size:13px;color:#44403c;line-height:1.9;margin:12px 0 0"><strong>When we send you a client, please give them priority.</strong> These are members who chose Consiere because they expect the best. Your reputation and ours grow together.</p>
    </div>
    <p style="font-size:13px;color:#44403c;line-height:1.9;margin:20px 0">I would love to have <strong>${vendor.name}</strong> as part of our global network. Joining takes less than 5 minutes.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="https://consiere.com.au/vendors" style="display:inline-block;padding:14px 40px;background:#1a1612;color:#fff;text-decoration:none;font-size:13px;font-weight:600;border-radius:4px">Register as a Vendor Partner &rarr;</a>
    </div>
    <p style="font-size:12px;color:#78716c;margin:20px 0">If you have any questions, simply reply to this email and I will personally respond within 24 hours.</p>
    <p style="font-size:13px;color:#1a1612;margin:24px 0 2px">Warm regards,</p>
    <p style="font-size:14px;color:#1a1612;font-weight:600;margin:0">Asif</p>
    <p style="font-size:12px;color:#78716c;margin:2px 0">Founder, Consiere</p>
    <p style="font-size:12px;color:#c9a96e;margin:2px 0">hello@consiere.com.au &middot; consiere.com.au</p>
  </div>
  <div style="background:#faf7f3;padding:16px 32px;border-top:1px solid #e2dbd3;text-align:center">
    <p style="font-size:11px;color:#a8a29e;margin:0">Consiere &middot; hello@consiere.com.au &middot; Sydney, Australia</p>
    <p style="font-size:10px;color:#c4bdb6;margin:4px 0 0">To opt out, reply with "unsubscribe".</p>
  </div>
</div></body></html>`;
}

async function sendAll() {
  const isDryRun = process.argv.includes('--dry-run');

  // Group by country for summary
  const byCountry = {};
  vendors.forEach(v => { byCountry[v.country] = (byCountry[v.country]||0)+1; });

  if (isDryRun) {
    console.log('DRY RUN — no emails sent\n');
    vendors.forEach((v,i) => console.log(`${i+1}. [${v.country}] ${v.name} → ${v.email}`));
    console.log('\nBy country:');
    Object.entries(byCountry).forEach(([c,n]) => console.log(` ${c}: ${n}`));
    console.log(`\nTotal: ${vendors.length} vendors`);
    return;
  }

  console.log(`\nStarting global vendor outreach — ${vendors.length} vendors\n`);
  let sent=0, failed=0;

  for (const vendor of vendors) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const result = await resend.emails.send({
        from: 'Asif at Consiere <hello@consiere.com.au>',
        to: vendor.email,
        replyTo: 'hello@consiere.com.au',
        subject: `Partnership invitation — Consiere global concierge network`,
        html: buildEmail(vendor),
      });
      if (result.error) { console.log(`FAILED  [${vendor.country}] ${vendor.name}: ${result.error.message}`); failed++; }
      else { console.log(`SENT    [${vendor.country}] ${vendor.name} → ${vendor.email}`); sent++; }
    } catch(e) { console.log(`ERROR   [${vendor.country}] ${vendor.name}: ${e.message}`); failed++; }
  }

  console.log('\n═══════════════════════════════════');
  console.log(`Sent:   ${sent}`);
  console.log(`Failed: ${failed}`);
  console.log('\nBy country:');
  Object.entries(byCountry).forEach(([c,n]) => console.log(` ${c}: ${n}`));
}

sendAll().catch(console.error);
