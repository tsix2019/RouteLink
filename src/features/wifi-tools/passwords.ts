/**
 * Common Wi-Fi passwords (design §17.4): well-known weak choices, number and keyboard patterns, words and
 * Chinese pinyin phrases people use, and router defaults. Checked in lower case; the rules in
 * security.ts catch most of the rest (digits only, sequences, repeats, the SSID).
 */
const WORDS = `
password password1 password12 password123 passw0rd p@ssw0rd p@ssword admin admin123 admin1234 administrator
root root123 guest guest123 user user1234 letmein letmein1 welcome welcome1 welcome123 iloveyou iloveyou1
qwerty qwerty1 qwerty12 qwerty123 qwerty1234 qwertyuiop qwertyui asdfgh asdfghjk asdfghjkl zxcvbn zxcvbnm
1qaz2wsx 1qaz2wsx3edc qazwsx qazwsxedc qwer1234 asdf1234 zxcv1234 abcd1234 abc123456 abc12345 abcdefgh
abcdefg1 a1234567 a12345678 a123456789 aa123456 aa12345678 aaa12345 q1w2e3r4 q1w2e3r4t5 1q2w3e4r 1q2w3e4r5t
monkey dragon dragon123 football baseball basketball soccer hockey master master123 superman batman
sunshine shadow princess michael jennifer jordan23 charlie freedom whatever trustno1 starwars computer
internet wireless network wifi12345 wifi123456 wifipassword mywifi mywifi123 homewifi home1234 home12345
myhome family family123 changeme changeme1 default default1 secret secret123 test1234 test12345 testtest
hello123 hello1234 helloworld lovely loveme lover love1234 love12345 baby1234 cookie cookies chocolate
pokemon minecraft fortnite matrix mustang ferrari porsche harley yankees liverpool arsenal chelsea barcelona
summer2024 summer2025 summer2026 winter2024 winter2025 spring2025 autumn2025 january february october
november december monday friday sunday
woaini woaini1314 woaini520 woaini123 woaini1234 wo123456 aini1314 iloveyou520 520520520 5201314 52013140
1314520 13145200 woshishui woshiniba nihao123 nihao1234 zhangwei wangwei liwei zhangsan lisi wangwu
zhang123 wang1234 li123456 liu123456 chen1234 yang1234 huang123 zhao1234 zhou1234 wu123456 xu123456
sun123456 ma123456 zhu123456 hu123456 guo123456 he123456 lin123456 luo123456 gao123456 zheng123
shanghai beijing guangzhou shenzhen chengdu hangzhou nanjing wuhan tianjin chongqing xiamen suzhou
zhongguo china123 chinese huawei xiaomi tplink tp-link tplink123 mercury fast1234 tenda1234 netgear
linksys dlink d-link asus1234 openwrt openwrt123 lede1234 immortalwrt routelink router router123
router1234 modem123 password.com admin@123 admin@1234 admin888 admin666 admin520 abc@123 abc@1234
qwe123456 qwe12345 qweasd qweasd123 qweasdzxc asd123456 asd12345 zxc123456 zxc12345 aaa111 aaa123
asdasd asdasd123 qweqwe qweqwe123 zxczxc woaiwojia wojia123 jiating jiaren mima1234 mima12345
mimamima wifimima wuxianwang shangwang meiyoumima buzhidao bugaosuni caicaikan nicaia 88888888 66666666
`;

const NUMBERS = `
12345678 123456789 1234567890 0123456789 87654321 98765432 987654321 9876543210 11111111 00000000 22222222
33333333 44444444 55555555 66666666 77777777 88888888 99999999 12341234 12121212 11223344 12344321
11112222 12312312 123123123 147258369 159753456 789456123 147852369 741852963 963852741 321654987
13579246 24681357 135792468 10203040 12345612 12345687 99998888 11110000 10101010 13131313 52525252
19491001 19900101 20000101 20202020 20212021 20222022 20232023 20242024 20252025 20262026 19881988
19891989 19901990 19911991 19921992 19931993 19941994 19951995 19961996 19971997 19981998 19992000
`;

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  `${WORDS} ${NUMBERS}`
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean),
);

/** Rows of a keyboard, for "pressed one key after another" patterns. */
export const KEYBOARD_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p'];
