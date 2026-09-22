// A studio lot is a polygon, never a name.
//
// The product's question in Los Angeles is not "was this filmed in LA" — almost
// everything was. It is **"can I go and stand there?"**, and the answer splits in two:
//
//   * a street, a house, a diner  → you can walk to it, and it is the place in the film
//   * a lot, a soundstage, a ranch → you cannot walk in, and what it filmed is set
//                                    somewhere else entirely
//
// Courthouse Square at Universal is Hill Valley in three Back to the Future films and is
// in California; New York Street at Warner Bros. is New York in Blade Runner, Batman
// Returns, Cloverfield and The Artist and has never been within 3,000 km of it. Printing
// those beside a real address without a word is the confident false claim this project's
// grounding rule exists to prevent.
//
// **Why a polygon and not a name.** [[work-profile]] already records what a name test
// costs: the old scene-image matcher ran /studio/i over place names, which calls the
// Studio Ghibli Museum a soundstage. Measured here on the 5,266 Los Angeles rows in the
// queue, the same regex gets both directions wrong:
//
//   Disney Hall              → matched "Disney". It is Walt Disney Concert Hall, a
//                              Gehry building on Grand Avenue that anybody can walk to.
//   Hilton Universal City    → matched "Universal". A hotel across the street.
//   Culver City High School  → matched "Culver". A school.
//   New York City Backlot    → NOT matched. It is inside Paramount.
//   Courthouse Square        → NOT matched. It is inside Universal.
//   Hennesy Street           → NOT matched. It is inside Warner Bros.
//
// A coordinate cannot be argued with. Every row in this queue already has one, so the
// test is: **is the point inside the fence.** The boundaries come from OpenStreetMap,
// each entry naming the way or relation it was taken from so it can be re-checked.
//
// **Why not a radius**, which is what [[directory]] uses for a city: a city is a fuzzy
// idea and a lot is a legal parcel with a wall around it. A radius over Universal large
// enough to cover the backlot also covers the Hilton, and the bounding box does too —
// that was measured before this file was written, and is why the rings are here in full.
//
// A relation that declares an `outer` ring means it: Universal's carries one outer plus
// 103 building footprints, and using them all would put the backlot STREETS, which are
// the whole point, outside the lot. Paramount's carries no outer at all — its members are
// the six parcels the lot is assembled from — so there, every member is used.
//
// **The list began as Los Angeles because Los Angeles is what was asked for**, and the
// mechanism never was. #196 added the lots the queue actually sits beside elsewhere:
// Silvercup, Steiner and Kaufman Astoria in New York; Pinewood, Elstree, BBC Elstree and
// Leavesden around London; and the two Hollywood stages the first 25 missed. The rows
// within ~600 m of each, counted before adding, were 63, 22 and 19 in New York, and 47,
// 16 and 13 around London. New entries come from scripts/studio-lot-from-osm.mjs, which
// is this recipe as a program. Cinecittà and Babelsberg belong here too; the queue
// holds four rows near them and none inside.
//
// Simplified to 2.2 m (Ramer-Douglas-Peucker) and stored at five decimals, which is about
// a metre. Both were checked against all 5,266 rows before being applied: **no row
// changes which lot it is in, or whether it is in one.** A lot boundary is a fence, not a
// survey.

import { ACCESS } from "./place-access.mjs";
import { finiteOrNull } from "./numbers.mjs";

// `access` is the vocabulary from [[three-axes]], not a new one:
//   ticketed  — a public studio tour, booked in advance. Four lots run one.
//   open      — public land. Paramount Ranch is a National Park Service site.
//   view_only — a working lot. You can stand at the gate and no further.
//
// It deliberately carries no price and no opening hours: those change every season, and
// a number this file cannot keep true is worse than no number.
export const STUDIO_LOTS = Object.freeze([
  {
    slug: "fox-century-city",
    name: "20th Century Studios",
    osm: "way/24655753",
    wikidata: "Q434841",
    access: ACCESS.view_only,
    rings: [
      [[34.05371,-118.41399], [34.05409,-118.41474], [34.05331,-118.41567], [34.05297,-118.41625], [34.04925,-118.41301], [34.0492,-118.41298], [34.04914,-118.41308], [34.0489,-118.41287], [34.05124,-118.40889], [34.0513,-118.4089], [34.0528,-118.41039], [34.05383,-118.41154], [34.0534,-118.41218], [34.05433,-118.41308], [34.05423,-118.4132], [34.05413,-118.41326], [34.05397,-118.41351], [34.05407,-118.4136], [34.05392,-118.41384]],
    ],
  },
  {
    slug: "cbs-studio-center",
    name: "CBS Studio Center",
    osm: "relation/12360811",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.14416,-118.39263], [34.14197,-118.38786], [34.14255,-118.38783], [34.1429,-118.38807], [34.14334,-118.38831], [34.14519,-118.38907], [34.1456,-118.38932], [34.14587,-118.38955], [34.14626,-118.39003], [34.14648,-118.39045], [34.14663,-118.39088], [34.14685,-118.39195], [34.14677,-118.39203], [34.14663,-118.392], [34.14613,-118.39211]],
      [[34.14627,-118.38926], [34.14626,-118.38934], [34.14709,-118.38966], [34.14745,-118.38983], [34.14815,-118.39028], [34.1485,-118.39058], [34.14903,-118.39113], [34.14922,-118.39139], [34.14924,-118.39149], [34.1494,-118.39165], [34.14953,-118.39191], [34.14737,-118.39192], [34.14705,-118.39196], [34.1468,-118.39086], [34.14669,-118.39052], [34.14647,-118.39005], [34.14606,-118.38948], [34.1457,-118.38916], [34.14532,-118.38892], [34.14532,-118.3889]],
    ],
  },
  {
    slug: "golden-oak-ranch",
    name: "Disney's Golden Oak Ranch",
    osm: "way/1365627456",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.374,-118.48463], [34.37396,-118.48023], [34.37305,-118.48025], [34.37301,-118.47586], [34.37595,-118.47582], [34.37593,-118.47213], [34.37799,-118.47216], [34.37798,-118.47118], [34.38027,-118.47122], [34.38036,-118.46667], [34.38466,-118.46693], [34.38461,-118.46252], [34.39121,-118.46284], [34.39119,-118.47162], [34.39079,-118.47249], [34.39079,-118.47354], [34.39049,-118.47351], [34.39047,-118.47422], [34.39015,-118.47487], [34.39039,-118.4754], [34.39006,-118.47609], [34.38968,-118.47631], [34.38937,-118.47737], [34.38888,-118.47808], [34.38826,-118.47719], [34.38711,-118.47709], [34.38697,-118.47791], [34.38629,-118.47826], [34.38567,-118.479], [34.38606,-118.48089], [34.38511,-118.48088], [34.38503,-118.48213], [34.38526,-118.48255], [34.38338,-118.48602], [34.38263,-118.48733], [34.38204,-118.48788], [34.38124,-118.48873], [34.3812,-118.48886], [34.38132,-118.489], [34.38001,-118.49049], [34.37915,-118.49135], [34.37784,-118.49256], [34.37762,-118.49274], [34.37747,-118.49278], [34.37733,-118.49272], [34.37688,-118.49233], [34.37636,-118.49288], [34.37627,-118.493], [34.37595,-118.49409], [34.37595,-118.49457], [34.37567,-118.49506], [34.37559,-118.49513], [34.3756,-118.4952], [34.37548,-118.49539], [34.3751,-118.49594], [34.37482,-118.4962], [34.37378,-118.4975], [34.37232,-118.49739], [34.37224,-118.48909], [34.37043,-118.48909], [34.37037,-118.48471]],
    ],
  },
  {
    slug: "dreamworks-glendale",
    name: "DreamWorks Studios",
    osm: "way/83417059",
    wikidata: "Q192557",
    access: ACCESS.view_only,
    rings: [
      [[34.15866,-118.28575], [34.15738,-118.284], [34.15688,-118.28344], [34.15679,-118.28324], [34.15677,-118.28306], [34.15674,-118.28307], [34.15669,-118.28327], [34.15668,-118.28341], [34.1567,-118.28341], [34.15658,-118.28566], [34.15655,-118.28568], [34.15646,-118.2875], [34.15646,-118.28791], [34.15649,-118.28791], [34.15649,-118.28803], [34.15663,-118.28788]],
    ],
  },
  {
    slug: "la-center-studios",
    name: "Los Angeles Center Studios",
    osm: "way/246965874",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.05583,-118.25853], [34.05658,-118.26031], [34.05406,-118.26179], [34.05337,-118.26014], [34.05326,-118.25986], [34.05326,-118.2598], [34.05556,-118.25771], [34.05562,-118.25769], [34.05569,-118.25771], [34.05617,-118.25797], [34.05615,-118.25805], [34.05574,-118.25829]],
    ],
  },
  {
    slug: "mbs-manhattan-beach",
    name: "MBS Media Campus",
    osm: "way/372872896",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[33.90167,-118.38331], [33.90172,-118.38345], [33.90172,-118.38441], [33.89867,-118.38435], [33.89867,-118.3852], [33.89629,-118.38519], [33.89628,-118.38328], [33.89566,-118.38326], [33.89568,-118.38307], [33.89833,-118.38306], [33.89871,-118.38312], [33.89872,-118.38337], [33.90068,-118.38338]],
    ],
  },
  {
    slug: "mack-sennett",
    name: "Mack Sennett Studios",
    osm: "way/419959463",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.09558,-118.28235], [34.0957,-118.2826], [34.09569,-118.28183], [34.09542,-118.282]],
    ],
  },
  {
    slug: "nickelodeon-burbank",
    name: "Nickelodeon Animation Studio",
    osm: "way/37395470",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.17556,-118.31457], [34.17438,-118.31581], [34.17461,-118.31611], [34.17412,-118.31661], [34.17485,-118.31697], [34.175,-118.31652], [34.17611,-118.31536], [34.17612,-118.3153], [34.17559,-118.31457]],
    ],
  },
  {
    slug: "paramount-pictures",
    name: "Paramount Pictures Studios",
    osm: "relation/14739293",
    wikidata: "Q16668873",
    access: ACCESS.ticketed,
    rings: [
      [[34.08713,-118.31584], [34.08711,-118.32219], [34.08361,-118.32216], [34.08362,-118.31586], [34.08648,-118.31584]],
      [[34.08432,-118.32237], [34.08432,-118.32267], [34.08398,-118.32266], [34.08398,-118.32236]],
      [[34.08542,-118.32345], [34.0854,-118.32345], [34.0854,-118.32377], [34.08545,-118.32377], [34.08545,-118.32382], [34.08569,-118.32381], [34.08569,-118.32377], [34.08573,-118.32377], [34.08574,-118.32243], [34.0854,-118.32245], [34.08542,-118.32337]],
      [[34.08338,-118.3206], [34.08338,-118.31968], [34.08308,-118.31968], [34.08308,-118.31993], [34.08313,-118.31993], [34.08313,-118.3206]],
      [[34.08339,-118.31868], [34.08339,-118.31801], [34.08296,-118.31801], [34.08296,-118.31868]],
      [[34.0881,-118.31558], [34.08822,-118.31558], [34.08822,-118.31561], [34.08857,-118.3156], [34.08857,-118.31556], [34.08861,-118.31556], [34.08861,-118.31524], [34.08857,-118.31525], [34.08857,-118.31518], [34.08731,-118.31518], [34.08727,-118.31518], [34.08728,-118.31556], [34.08726,-118.31559], [34.08728,-118.31562], [34.08731,-118.31558], [34.08736,-118.3156], [34.08738,-118.31558], [34.08738,-118.31561], [34.08799,-118.31561], [34.08799,-118.31558], [34.08806,-118.31558], [34.08806,-118.31563], [34.08809,-118.31563], [34.08809,-118.31558]],
    ],
  },
  {
    slug: "paramount-ranch",
    name: "Paramount Ranch",
    osm: "relation/10722231",
    wikidata: null,
    access: ACCESS.open,
    rings: [
      [[34.11815,-118.75041], [34.11811,-118.74566], [34.11067,-118.74573], [34.11227,-118.74738], [34.11257,-118.74788], [34.11323,-118.74951], [34.1133,-118.75], [34.1133,-118.7504], [34.11283,-118.75304], [34.11267,-118.75334], [34.11179,-118.75443], [34.11146,-118.7549], [34.11116,-118.75554], [34.11116,-118.76416], [34.11353,-118.76655], [34.11404,-118.76755], [34.11789,-118.77598], [34.11931,-118.76682], [34.12926,-118.76878], [34.12392,-118.75532], [34.12543,-118.75475], [34.12619,-118.75358], [34.12624,-118.75226], [34.12638,-118.75127], [34.12595,-118.7506], [34.12557,-118.75014], [34.12501,-118.7497], [34.12476,-118.74962], [34.12458,-118.74961], [34.12431,-118.74966], [34.12374,-118.74986], [34.12316,-118.74993], [34.11987,-118.75031], [34.11987,-118.7502]],
    ],
  },
  {
    slug: "prospect-studios",
    name: "Prospect Studios",
    osm: "way/77504482",
    wikidata: "Q3030464",
    access: ACCESS.view_only,
    rings: [
      [[34.10407,-118.28295], [34.10407,-118.28091], [34.10443,-118.28086], [34.10443,-118.28038], [34.1036,-118.28037], [34.10359,-118.27871], [34.10189,-118.27872], [34.10189,-118.28278], [34.10201,-118.28296], [34.1036,-118.28296]],
    ],
  },
  {
    slug: "raleigh-hollywood",
    name: "Raleigh Studios Hollywood",
    osm: "way/82586835",
    wikidata: "Q2380474",
    access: ACCESS.view_only,
    rings: [
      [[34.08334,-118.31585], [34.0834,-118.31592], [34.0834,-118.31777], [34.08337,-118.3178], [34.08175,-118.3178], [34.08176,-118.31587], [34.08178,-118.31584]],
    ],
  },
  {
    slug: "sony-imageworks",
    name: "Sony Pictures Imageworks",
    osm: "way/908932225",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.02466,-118.39217], [34.02463,-118.39218], [34.02417,-118.3915], [34.0253,-118.38996], [34.02535,-118.38996], [34.0257,-118.3904], [34.02571,-118.39046]],
    ],
  },
  {
    slug: "sony-pictures",
    name: "Sony Pictures Studios",
    osm: "way/24655474",
    wikidata: "Q2499130",
    access: ACCESS.ticketed,
    rings: [
      [[34.01689,-118.40522], [34.01684,-118.40522], [34.01662,-118.40486], [34.01589,-118.40419], [34.01587,-118.40411], [34.0159,-118.40407], [34.01573,-118.40393], [34.01568,-118.40393], [34.01553,-118.40382], [34.01415,-118.40262], [34.01419,-118.40254], [34.01415,-118.40247], [34.01438,-118.40223], [34.0167,-118.40036], [34.01674,-118.40041], [34.01677,-118.40038], [34.0169,-118.40044], [34.01701,-118.40026], [34.01697,-118.40022], [34.01701,-118.40019], [34.01696,-118.40014], [34.0184,-118.39898], [34.0196,-118.39812], [34.01963,-118.39816], [34.01968,-118.39814], [34.02059,-118.399], [34.02059,-118.39904], [34.0199,-118.4002], [34.01993,-118.40023], [34.01973,-118.40057], [34.0197,-118.40056], [34.01738,-118.40446], [34.01724,-118.40464]],
    ],
  },
  {
    slug: "sunset-bronson",
    name: "Sunset Bronson Studios",
    osm: "way/908232075",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.09757,-118.31854], [34.09728,-118.31854], [34.09728,-118.31788], [34.09588,-118.31787], [34.09588,-118.31745], [34.09574,-118.31745], [34.09574,-118.31611], [34.09587,-118.31612], [34.09588,-118.31586], [34.09793,-118.31587], [34.09792,-118.31788], [34.09758,-118.31788], [34.09758,-118.31812]],
    ],
  },
  {
    slug: "sunset-gower",
    name: "Sunset Gower Studios",
    osm: "way/908238174",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.09789,-118.32221], [34.09791,-118.32068], [34.09748,-118.32067], [34.09748,-118.32022], [34.09449,-118.32019], [34.09447,-118.32216]],
    ],
  },
  {
    slug: "sunset-las-palmas",
    name: "Sunset Las Palmas Studios",
    osm: "relation/7092701",
    wikidata: "Q5882664",
    access: ACCESS.view_only,
    rings: [
      [[34.08927,-118.33265], [34.08927,-118.33284], [34.08913,-118.33284], [34.08913,-118.33309], [34.08899,-118.33309], [34.08899,-118.33219], [34.08941,-118.33219], [34.0894,-118.33264]],
      [[34.08982,-118.33265], [34.08982,-118.33219], [34.09021,-118.33219], [34.09022,-118.33273], [34.09062,-118.33274], [34.09062,-118.33306], [34.09057,-118.33311], [34.09009,-118.3331], [34.09009,-118.33266]],
      [[34.09061,-118.33504], [34.09062,-118.33335], [34.09057,-118.33328], [34.09022,-118.33328], [34.09022,-118.33385], [34.08966,-118.33384], [34.08965,-118.33328], [34.08903,-118.33327], [34.089,-118.33332], [34.089,-118.33617], [34.09023,-118.33618], [34.09023,-118.33586], [34.09061,-118.33586], [34.09061,-118.3353]],
      [[34.08884,-118.33503], [34.08781,-118.33504], [34.08779,-118.33614], [34.08779,-118.3362], [34.08883,-118.3362]],
      [[34.09062,-118.33274], [34.09062,-118.33306], [34.09057,-118.33311], [34.08927,-118.33312], [34.08927,-118.33265], [34.08982,-118.33265], [34.08982,-118.33219], [34.09021,-118.33219], [34.09022,-118.33273]],
    ],
  },
  {
    slug: "television-city",
    name: "Television City",
    osm: "way/132789283",
    wikidata: "Q5009284",
    access: ACCESS.view_only,
    rings: [
      [[34.07391,-118.36125], [34.07594,-118.36125], [34.07593,-118.35727], [34.07471,-118.35726], [34.07471,-118.35647], [34.0736,-118.35646], [34.07358,-118.35826], [34.07366,-118.35831], [34.07387,-118.35834], [34.07392,-118.35845], [34.07391,-118.35982]],
    ],
  },
  {
    slug: "burbank-studios",
    name: "The Burbank Studios",
    osm: "way/32012564",
    wikidata: "Q7720617",
    access: ACCESS.view_only,
    rings: [
      [[34.15493,-118.3359], [34.1558,-118.33494], [34.15668,-118.33229], [34.15341,-118.33071], [34.1527,-118.33285], [34.15269,-118.33352], [34.15273,-118.33419], [34.15292,-118.33513], [34.15315,-118.33509], [34.15329,-118.33512], [34.15491,-118.33591]],
    ],
  },
  {
    slug: "culver-studios",
    name: "The Culver Studios",
    osm: "way/24655484",
    wikidata: "Q3699365",
    access: ACCESS.view_only,
    rings: [
      [[34.02453,-118.39242], [34.02394,-118.39341], [34.0238,-118.39327], [34.02271,-118.39133], [34.02236,-118.39161], [34.0217,-118.3904], [34.022,-118.39016], [34.02104,-118.38839], [34.02149,-118.38795], [34.02394,-118.39153]],
    ],
  },
  {
    slug: "jim-henson-lot",
    name: "The Jim Henson Company Lot",
    osm: "way/911053215",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.09704,-118.34397], [34.09704,-118.34299], [34.09623,-118.34298], [34.09623,-118.34396]],
    ],
  },
  {
    slug: "universal-city",
    name: "Universal Studios Lot",
    osm: "relation/19972956",
    wikidata: "Q30632606",
    access: ACCESS.ticketed,
    rings: [
      [[34.13134,-118.3489], [34.13086,-118.34856], [34.12943,-118.34718], [34.12947,-118.34714], [34.12939,-118.34681], [34.13082,-118.3456], [34.1309,-118.34571], [34.13091,-118.34588], [34.13085,-118.34591], [34.13087,-118.34616], [34.13076,-118.34703], [34.13103,-118.34728], [34.13114,-118.34732], [34.13116,-118.34727], [34.13153,-118.34767], [34.13167,-118.34755], [34.13214,-118.34848], [34.13247,-118.34867], [34.13291,-118.34846], [34.1331,-118.34769], [34.13347,-118.34781], [34.13368,-118.34765], [34.13392,-118.34672], [34.13422,-118.3467], [34.13439,-118.34653], [34.13465,-118.34657], [34.13471,-118.34613], [34.13471,-118.34589], [34.13513,-118.34561], [34.13596,-118.34441], [34.13622,-118.34428], [34.1368,-118.34445], [34.13792,-118.34399], [34.13807,-118.34383], [34.13827,-118.34306], [34.13844,-118.34307], [34.13877,-118.34317], [34.13896,-118.34313], [34.13914,-118.34292], [34.13938,-118.34257], [34.13952,-118.34243], [34.13957,-118.34219], [34.13977,-118.34202], [34.14035,-118.34202], [34.141,-118.34183], [34.1416,-118.34198], [34.142,-118.34198], [34.14246,-118.34192], [34.14273,-118.34186], [34.14432,-118.34118], [34.14434,-118.34112], [34.14466,-118.34108], [34.14427,-118.34193], [34.14366,-118.34299], [34.14285,-118.34422], [34.14253,-118.3448], [34.14219,-118.34574], [34.14205,-118.3464], [34.14199,-118.34709], [34.142,-118.34777], [34.14208,-118.34846], [34.14283,-118.35199], [34.14294,-118.35292], [34.143,-118.35389], [34.14324,-118.36134], [34.14317,-118.36134], [34.14317,-118.36132], [34.14305,-118.36129], [34.14279,-118.36116], [34.14274,-118.36111], [34.14207,-118.36074], [34.14129,-118.36075], [34.14102,-118.36082], [34.13939,-118.36175], [34.13912,-118.36175], [34.1391,-118.36159], [34.13895,-118.36158], [34.1389,-118.36124], [34.13894,-118.35805], [34.13946,-118.35804], [34.13963,-118.35843], [34.13986,-118.35847], [34.14021,-118.35863], [34.14054,-118.3586], [34.14054,-118.35843], [34.14064,-118.35836], [34.14177,-118.35834], [34.14185,-118.35824], [34.14185,-118.35753], [34.14188,-118.35753], [34.14188,-118.3574], [34.14185,-118.3574], [34.14185,-118.35716], [34.1418,-118.35716], [34.14178,-118.35649], [34.14129,-118.35651], [34.14128,-118.35634], [34.14119,-118.35634], [34.14116,-118.35531], [34.14111,-118.35518], [34.14114,-118.35493], [34.1411,-118.35473], [34.1404,-118.3545], [34.14071,-118.35346], [34.14027,-118.35312], [34.13978,-118.35226], [34.13992,-118.35215], [34.1399,-118.35198], [34.13977,-118.35184], [34.13976,-118.3516], [34.13986,-118.35135], [34.13926,-118.35057], [34.13914,-118.35052], [34.13884,-118.35061], [34.13876,-118.35057], [34.13871,-118.3505], [34.13861,-118.3503], [34.13844,-118.34986], [34.13843,-118.34964], [34.13854,-118.34935], [34.13864,-118.34917], [34.13854,-118.34911], [34.13818,-118.34912], [34.13756,-118.34939], [34.13733,-118.34944], [34.13717,-118.34958], [34.13704,-118.34956], [34.13628,-118.34971], [34.13612,-118.34967], [34.13594,-118.34971], [34.13574,-118.3495], [34.13565,-118.34949], [34.13487,-118.3496], [34.13479,-118.3495], [34.13464,-118.3496], [34.13438,-118.3491], [34.13422,-118.34892], [34.13401,-118.34881], [34.13384,-118.34879], [34.13368,-118.34882], [34.13348,-118.34895], [34.13333,-118.3492], [34.13312,-118.35004], [34.13311,-118.35017], [34.13278,-118.34978], [34.13271,-118.34985], [34.13262,-118.34983], [34.13215,-118.34943], [34.13202,-118.34937], [34.13173,-118.34915]],
    ],
  },
  {
    slug: "walt-disney-burbank",
    name: "Walt Disney Studios",
    osm: "way/105031658",
    wikidata: "Q2078595",
    access: ACCESS.view_only,
    rings: [
      [[34.15485,-118.32545], [34.1548,-118.32532], [34.15464,-118.32524], [34.15425,-118.32581], [34.15416,-118.32574], [34.15458,-118.32381], [34.15574,-118.32213], [34.15611,-118.32231], [34.15602,-118.32286], [34.15586,-118.3233], [34.15563,-118.32376], [34.15467,-118.32517], [34.15481,-118.32526], [34.15488,-118.3254], [34.15581,-118.32403], [34.15607,-118.32354], [34.15619,-118.32323], [34.15636,-118.32259], [34.15643,-118.32256], [34.15945,-118.32404], [34.15891,-118.32566], [34.15882,-118.32573], [34.1587,-118.32607], [34.15871,-118.32621], [34.15818,-118.32787], [34.1581,-118.32792], [34.15691,-118.32733], [34.15612,-118.32697], [34.15573,-118.32674], [34.15444,-118.32614], [34.15443,-118.32608], [34.15455,-118.32596], [34.15454,-118.32592]],
    ],
  },
  {
    slug: "warner-bros-ranch",
    name: "Warner Bros. Ranch",
    osm: "way/1096164049",
    wikidata: "Q5149808",
    access: ACCESS.view_only,
    rings: [
      [[34.15959,-118.34753], [34.16022,-118.34564], [34.15931,-118.3452], [34.15959,-118.34434], [34.15955,-118.34431], [34.15971,-118.34383], [34.15922,-118.34359], [34.1594,-118.34301], [34.15765,-118.34223], [34.15759,-118.34225], [34.15632,-118.34598], [34.15957,-118.34754]],
    ],
  },
  {
    slug: "warner-bros-burbank",
    name: "Warner Bros. Studios Burbank",
    osm: "way/85709299",
    wikidata: null,
    access: ACCESS.ticketed,
    rings: [
      [[34.15229,-118.33861], [34.1523,-118.33868], [34.15187,-118.33913], [34.15175,-118.33911], [34.15169,-118.33929], [34.1517,-118.33933], [34.14928,-118.34186], [34.14893,-118.34203], [34.14881,-118.34206], [34.14846,-118.34206], [34.1483,-118.34204], [34.14821,-118.342], [34.14801,-118.34262], [34.14797,-118.3426], [34.14793,-118.34271], [34.14809,-118.34278], [34.14804,-118.34292], [34.14767,-118.34274], [34.14739,-118.34352], [34.14704,-118.34334], [34.14709,-118.34321], [34.14692,-118.34313], [34.1469,-118.34317], [34.1466,-118.343], [34.14671,-118.34264], [34.14666,-118.34261], [34.14685,-118.34207], [34.14668,-118.34198], [34.14688,-118.34137], [34.14576,-118.3408], [34.14533,-118.34072], [34.14556,-118.34002], [34.14547,-118.33958], [34.14562,-118.33807], [34.14583,-118.33726], [34.14558,-118.33717], [34.14592,-118.33638], [34.14546,-118.33616], [34.14553,-118.33535], [34.14593,-118.33325], [34.14612,-118.33274], [34.1468,-118.33226], [34.14701,-118.33219], [34.1477,-118.33253], [34.14803,-118.33183], [34.14807,-118.33186], [34.14782,-118.33258], [34.14822,-118.33279], [34.14835,-118.33296], [34.15183,-118.33462], [34.15187,-118.33483], [34.15164,-118.33551], [34.1516,-118.33572], [34.15135,-118.33649], [34.15129,-118.33656], [34.15091,-118.33768], [34.15182,-118.33811], [34.15207,-118.33828], [34.15216,-118.3384]],
    ],
  },
  // The gap #196 found: Red Studios (once Ren-Mar) carries no P31 in Wikidata at all, so
  // without a fence it read as a street. OSM names it "RSH Studios Hollywood".
  {
    slug: "red-studios-hollywood",
    name: "Red Studios Hollywood",
    osm: "way/372859983",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.08673,-118.32827], [34.08704,-118.32827], [34.08704,-118.32782], [34.08536,-118.32782], [34.08536,-118.32867], [34.08673,-118.32867]],
    ],
  },
  // Formerly Warner Hollywood / Samuel Goldwyn Studios, on Formosa Avenue.
  {
    slug: "the-lot-hollywood",
    name: "The Lot",
    osm: "relation/12370481",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[34.0888,-118.34763], [34.0888,-118.34859], [34.09064,-118.34859], [34.09063,-118.34632], [34.08868,-118.34635], [34.08868,-118.3466], [34.08874,-118.3466], [34.08874,-118.3469], [34.08866,-118.34695], [34.08866,-118.34746]],
      [[34.08883,-118.34615], [34.08843,-118.34615], [34.08843,-118.3457], [34.08883,-118.3457]],
    ],
  },
  // New York. Beyond Los Angeles from here on, in the order the queue needs them.
  {
    slug: "silvercup-studios",
    name: "Silvercup Studios",
    osm: "way/281332463",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[40.75166,-73.9435], [40.75104,-73.94403], [40.75098,-73.944], [40.75093,-73.94404], [40.75087,-73.94393], [40.75062,-73.94416], [40.75105,-73.94503], [40.75196,-73.94415]],
    ],
  },
  {
    slug: "steiner-studios",
    name: "Steiner Studios",
    osm: "relation/7114753",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[40.70221,-73.96826], [40.70212,-73.9683], [40.69998,-73.96844], [40.69998,-73.96857], [40.69918,-73.96862], [40.69918,-73.96846], [40.69915,-73.96846], [40.69913,-73.96784], [40.69878,-73.96782], [40.69877,-73.96752], [40.69781,-73.96757], [40.69774,-73.96578], [40.69982,-73.96602], [40.69982,-73.96608], [40.69977,-73.96609], [40.69978,-73.9662], [40.70016,-73.96618], [40.70017,-73.96645], [40.70215,-73.96641], [40.70293,-73.96741], [40.70292,-73.96748]],
      [[40.70298,-73.96718], [40.70238,-73.96657], [40.70192,-73.96598], [40.70131,-73.96509], [40.70179,-73.9644], [40.70401,-73.96716], [40.70402,-73.96721], [40.70397,-73.96727], [40.70368,-73.96719], [40.70309,-73.96722]],
    ],
  },
  // The building only: OSM draws no lot. The Museum of the Moving Image next door is a
  // place anybody can walk into and stays outside the fence.
  {
    slug: "kaufman-astoria",
    name: "Kaufman Astoria Studios",
    osm: "way/280571504",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[40.7564,-73.92452], [40.75668,-73.92513], [40.75748,-73.92449], [40.7572,-73.92387]],
    ],
  },
  {
    slug: "pinewood-studios",
    name: "Pinewood Studios",
    osm: "relation/13016756",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[51.54803,-0.53781], [51.54783,-0.53786], [51.54552,-0.53754], [51.54421,-0.53709], [51.5442,-0.53714], [51.54366,-0.53689], [51.54398,-0.53526], [51.54391,-0.53499], [51.54431,-0.533], [51.54463,-0.5331], [51.54479,-0.53108], [51.54743,-0.53139], [51.5486,-0.53158], [51.54869,-0.53172], [51.54869,-0.53185], [51.54894,-0.53189], [51.54926,-0.53175], [51.54954,-0.53179], [51.54992,-0.53209], [51.55034,-0.53265], [51.55036,-0.53278], [51.5503,-0.53298], [51.55039,-0.53315], [51.55052,-0.53308], [51.55071,-0.53312], [51.55149,-0.5343], [51.55226,-0.5356], [51.55225,-0.53568], [51.55234,-0.53584], [51.5524,-0.53582], [51.5527,-0.53634], [51.55233,-0.53729], [51.55125,-0.53735], [51.55097,-0.53741], [51.54972,-0.53782]],
      [[51.55005,-0.53186], [51.54985,-0.53164], [51.55017,-0.52879], [51.5502,-0.52858], [51.55027,-0.5284], [51.55048,-0.52821], [51.5509,-0.52829], [51.55117,-0.52823], [51.55198,-0.52764], [51.55227,-0.52851], [51.55302,-0.52938], [51.55329,-0.52945], [51.55359,-0.52966], [51.55381,-0.52987], [51.554,-0.53011], [51.55418,-0.53047], [51.55437,-0.53087], [51.55442,-0.53116], [51.55467,-0.53169], [51.55515,-0.5335], [51.55465,-0.53389], [51.55464,-0.53414], [51.55485,-0.53438], [51.555,-0.53426], [51.55512,-0.53468], [51.55545,-0.53447], [51.55545,-0.53474], [51.55525,-0.53508], [51.55497,-0.53544], [51.55453,-0.53679], [51.55428,-0.53739], [51.5541,-0.53778], [51.55389,-0.53799], [51.55091,-0.53306], [51.55081,-0.53285], [51.5508,-0.53265], [51.55089,-0.53248], [51.55094,-0.53243], [51.55106,-0.53259], [51.55122,-0.53237], [51.55116,-0.53225], [51.5511,-0.53202], [51.55108,-0.532], [51.55105,-0.53206], [51.55096,-0.53192], [51.55089,-0.53205], [51.55072,-0.5322], [51.55065,-0.53237], [51.55053,-0.53241], [51.55039,-0.53235]],
    ],
  },
  // Two rings: the studio and its backlot, drawn separately in OSM.
  {
    slug: "elstree-studios",
    name: "Elstree Studios",
    osm: "way/8045119 + way/226137599",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[51.65797,-0.27064], [51.65843,-0.26993], [51.65857,-0.26956], [51.65727,-0.26776], [51.65786,-0.26653], [51.6568,-0.26534], [51.65649,-0.26519], [51.65633,-0.26552], [51.65624,-0.26592], [51.65629,-0.2661], [51.65619,-0.26648], [51.65608,-0.26641], [51.65601,-0.26657], [51.65599,-0.26673], [51.65568,-0.26744], [51.65589,-0.26778], [51.65598,-0.26757], [51.65602,-0.26761], [51.65604,-0.26765], [51.65599,-0.26778], [51.65599,-0.26792], [51.65774,-0.27035], [51.65764,-0.27056], [51.65762,-0.27067], [51.65764,-0.27077], [51.65776,-0.27082], [51.65789,-0.27066]],
      [[51.65673,-0.26723], [51.65734,-0.2661], [51.65681,-0.26548], [51.65664,-0.2655], [51.65657,-0.26558], [51.65649,-0.2658], [51.65646,-0.26609], [51.65627,-0.26655]],
    ],
  },
  // A separate studio across the road (EastEnders), not part of Elstree Studios.
  {
    slug: "bbc-elstree-centre",
    name: "BBC Elstree Centre",
    osm: "way/4634851",
    wikidata: null,
    access: ACCESS.view_only,
    rings: [
      [[51.65893,-0.27308], [51.66031,-0.2742], [51.66021,-0.2746], [51.66018,-0.27529], [51.65972,-0.27646], [51.65961,-0.27673], [51.65956,-0.27669], [51.65884,-0.27844], [51.6581,-0.27769], [51.65848,-0.27629], [51.65751,-0.27525], [51.6586,-0.27279]],
    ],
  },
  // The Studio Tour (The Making of Harry Potter) is ticketed.
  {
    slug: "warner-bros-leavesden",
    name: "Warner Bros. Studios Leavesden",
    osm: "way/116820422",
    wikidata: null,
    access: ACCESS.ticketed,
    rings: [
      [[51.69157,-0.41585], [51.69177,-0.41575], [51.69181,-0.41581], [51.69188,-0.41578], [51.692,-0.41591], [51.69223,-0.41593], [51.69245,-0.41573], [51.69255,-0.41544], [51.6929,-0.4152], [51.6935,-0.41765], [51.69508,-0.41654], [51.69513,-0.41647], [51.69515,-0.41635], [51.69575,-0.41667], [51.69565,-0.41726], [51.69563,-0.41756], [51.69573,-0.41961], [51.69557,-0.42149], [51.69331,-0.42301], [51.69305,-0.42224], [51.69297,-0.42229], [51.69266,-0.42166], [51.69254,-0.4216], [51.69225,-0.42202], [51.69197,-0.4229], [51.6917,-0.42353], [51.69156,-0.42471], [51.69131,-0.42524], [51.69104,-0.42646], [51.69037,-0.42777], [51.69028,-0.42802], [51.69026,-0.4284], [51.69038,-0.42979], [51.68964,-0.42858], [51.68866,-0.42674], [51.68802,-0.4257], [51.68761,-0.42642], [51.68724,-0.42598], [51.68711,-0.42601], [51.68693,-0.42621], [51.68689,-0.4263], [51.68682,-0.42698], [51.68678,-0.42698], [51.68724,-0.42698], [51.68888,-0.42902], [51.6901,-0.43035], [51.69,-0.43043], [51.68959,-0.43026], [51.68934,-0.43027], [51.68913,-0.4303], [51.68875,-0.43053], [51.6886,-0.43057], [51.68815,-0.43052], [51.68812,-0.43045], [51.68798,-0.43047], [51.68795,-0.43056], [51.68695,-0.43071], [51.68609,-0.43103], [51.68601,-0.43095], [51.6857,-0.43089], [51.68557,-0.43073], [51.68529,-0.42985], [51.68465,-0.42917], [51.68448,-0.42882], [51.68436,-0.42839], [51.68426,-0.42769], [51.68429,-0.42728], [51.68424,-0.42692], [51.68424,-0.42548], [51.68468,-0.42382], [51.68561,-0.42072], [51.68592,-0.42], [51.68626,-0.4194], [51.68831,-0.41734], [51.68843,-0.41731], [51.68871,-0.41747], [51.68892,-0.41732], [51.68905,-0.41683], [51.68929,-0.41671], [51.69086,-0.41617]],
    ],
  }].map(Object.freeze));

// Ray casting. The ring is treated as closed — the last point joins the first — because
// that is how the rings are stored, without the repeated closing point.
function inRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    // Strictly one endpoint above the test latitude, so a vertex exactly on it is
    // counted once rather than twice.
    if ((latI > lat) !== (latJ > lat)) {
      const crossing = ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
      if (lng < crossing) inside = !inside;
    }
  }
  return inside;
}

// The lot this point is inside, or null. Null is the common answer and the important one:
// 96% of the Los Angeles rows in the queue are on the street, which is the product.
export function studioLotAt(lat, lng) {
  const y = finiteOrNull(lat);
  const x = finiteOrNull(lng);
  if (y === null || x === null) return null;
  // (0, 0) is not a place. Four incidents in this project, all from `Number("")` being 0.
  if (y === 0 && x === 0) return null;
  for (const lot of STUDIO_LOTS) {
    for (const ring of lot.rings) {
      if (inRing(y, x, ring)) return lot;
    }
  }
  return null;
}

export function findStudioLot(slug) {
  const wanted = String(slug ?? "").toLowerCase();
  return STUDIO_LOTS.find((lot) => lot.slug === wanted) ?? null;
}

// What the card says instead of an address. It states the two things a reader has to know
// before doing anything with the row — that the camera was here, and that what it filmed
// is set somewhere else — and never guesses WHERE else: the source recorded a lot, not a
// story location, and inventing one would be the same mistake in the other direction.
export function studioLotSentence(lot, placeName) {
  if (!lot) return null;
  const named = String(placeName ?? "").trim();
  // A backlot street has a name of its own — "New York Street", "Courthouse Square" — and
  // it is worth keeping: it is what somebody watching the film actually saw.
  const where = named && named.toLowerCase() !== lot.name.toLowerCase()
    ? `${named}, inside ${lot.name}`
    : lot.name;
  return `${where} — a studio lot. The camera was here; what it filmed is set somewhere else.`;
}

// Whether a reader can get to it, in the vocabulary the rest of the product already uses.
export function studioLotAccessNote(lot) {
  if (!lot) return null;
  if (lot.access === ACCESS.open) return "Public land — you can walk in.";
  if (lot.access === ACCESS.ticketed) return "A studio tour goes inside. Book ahead.";
  return "A working lot — no public access. The gate is as close as you get.";
}

// Wikidata's own word for it, verified live when these were chosen (location-resolver.mjs
// PLACE_TYPE_TARGETS): Q375336 "film studio" — Warner Bros. Burbank, Pinewood, Shepperton,
// Cinecittà — and Q21550789, the lot-as-a-building sense. Checked on the entity's own
// P31, not its ancestry: this runs per card, and one hop is what the entity states.
export const STUDIO_TYPES = Object.freeze(["Q375336", "Q21550789"]);

// The name test, kept for the one case nothing else can answer: a place with no
// coordinate. Measured on 5,436 Los Angeles queue rows it missed 166 places inside a
// lot ("New York Street", "Stars Hollow", "Courthouse Square") and called a bookshop
// and a jeweller in Studio City — a neighbourhood — studios. "Studio City" is excluded
// by name because it is the false alarm that recurs; the rest is why this is last.
const STUDIO_NAME = /\b(studio|studios|sound[ -]?stage)\b/i;
const STUDIO_CITY = /\bstudio city\b/gi;

// The neighbourhood is cut out before the test, so "CBS Studio Center, Studio City" is
// still a studio and "Bookstar (Studio City)" is not.
export function studioNameHint(name) {
  if (typeof name !== "string") return false;
  return STUDIO_NAME.test(name.replace(STUDIO_CITY, ""));
}

// Is this place a studio — somewhere the camera was, standing in for somewhere else?
//
// In order of what can be argued with least:
//   1. the coordinate is inside a lot's fence (a polygon from OpenStreetMap);
//   2. Wikidata states the place is a film studio;
//   3. a coordinate that is neither — it is on the street. The name is NOT consulted:
//      the false alarm ("a studio", said of a shop) makes a claim about the place, and
//      the miss (a stage we have no fence for) only costs a frame match that the matcher
//      is conservative enough to decline;
//   4. no coordinate at all — the name, and the answer says it came from the name.
//
// `basis` travels with the answer so a caller, a test or a log line can tell a fence
// from a guess.
export function studioVerdict({ name = null, lat = null, lng = null, instanceOf = [] } = {}) {
  const lot = studioLotAt(lat, lng);
  if (lot) return { studio: true, basis: "polygon", lot };
  const types = new Set(Array.isArray(instanceOf) ? instanceOf : []);
  if (STUDIO_TYPES.some((type) => types.has(type))) return { studio: true, basis: "type", lot: null };
  const hasCoordinate = finiteOrNull(lat) !== null && finiteOrNull(lng) !== null && !(Number(lat) === 0 && Number(lng) === 0);
  if (hasCoordinate) return { studio: false, basis: "coordinate", lot: null };
  return { studio: studioNameHint(name), basis: "name", lot: null };
}
