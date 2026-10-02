// Predložak za prizemlje kavane (tlocrt prizemlje.pdf): 35 stolova, 78 mjesta.
// P uz prozor, U unutarnji red, D podij, G desno gore, C centar (kvadratni za 2), O okrugli za 4.
// Koordinate su u jedinicama tlocrta (širina 1000, visina 700). Stolovi se poslije fino pomiču u uređivaču.
export const PRIZEMLJE_HEIGHT = 700;

export const PRIZEMLJE: {
  name: string; min_seats: number; max_seats: number; x: number; y: number; w: number; h: number;
  shape: "rect" | "round"; zone: string; combinable: boolean;
}[] = [
  { name: "P1", min_seats: 1, max_seats: 2, x: 305, y: 263, w: 34, h: 34, shape: "rect", zone: "uz prozor", combinable: true },
  { name: "P2", min_seats: 1, max_seats: 2, x: 302, y: 312, w: 34, h: 34, shape: "rect", zone: "uz prozor", combinable: true },
  { name: "P3", min_seats: 1, max_seats: 2, x: 299, y: 361, w: 34, h: 34, shape: "rect", zone: "uz prozor", combinable: true },
  { name: "P4", min_seats: 1, max_seats: 2, x: 296, y: 410, w: 34, h: 34, shape: "rect", zone: "uz prozor", combinable: true },
  { name: "P5", min_seats: 1, max_seats: 2, x: 293, y: 459, w: 34, h: 34, shape: "rect", zone: "uz prozor", combinable: true },
  { name: "P6", min_seats: 1, max_seats: 2, x: 290, y: 508, w: 34, h: 34, shape: "rect", zone: "uz prozor", combinable: true },
  { name: "P7", min_seats: 1, max_seats: 2, x: 287, y: 557, w: 34, h: 34, shape: "rect", zone: "uz prozor", combinable: true },
  { name: "U1", min_seats: 1, max_seats: 2, x: 353, y: 333, w: 34, h: 34, shape: "rect", zone: "unutarnji red", combinable: true },
  { name: "U2", min_seats: 1, max_seats: 2, x: 353, y: 403, w: 34, h: 34, shape: "rect", zone: "unutarnji red", combinable: true },
  { name: "U3", min_seats: 1, max_seats: 2, x: 353, y: 473, w: 34, h: 34, shape: "rect", zone: "unutarnji red", combinable: true },
  { name: "U4", min_seats: 1, max_seats: 2, x: 353, y: 543, w: 34, h: 34, shape: "rect", zone: "unutarnji red", combinable: true },
  { name: "U5", min_seats: 1, max_seats: 2, x: 423, y: 543, w: 34, h: 34, shape: "rect", zone: "unutarnji red", combinable: true },
  { name: "D1", min_seats: 1, max_seats: 2, x: 388, y: 165, w: 34, h: 34, shape: "rect", zone: "podij", combinable: true },
  { name: "D2", min_seats: 1, max_seats: 2, x: 469, y: 165, w: 34, h: 34, shape: "rect", zone: "podij", combinable: true },
  { name: "D3", min_seats: 1, max_seats: 2, x: 388, y: 221, w: 34, h: 34, shape: "rect", zone: "podij", combinable: true },
  { name: "D4", min_seats: 1, max_seats: 2, x: 469, y: 221, w: 34, h: 34, shape: "rect", zone: "podij", combinable: true },
  { name: "G1", min_seats: 1, max_seats: 2, x: 661, y: 165, w: 34, h: 34, shape: "rect", zone: "desno gore", combinable: true },
  { name: "G2", min_seats: 1, max_seats: 2, x: 719, y: 165, w: 34, h: 34, shape: "rect", zone: "desno gore", combinable: true },
  { name: "G3", min_seats: 1, max_seats: 2, x: 777, y: 165, w: 34, h: 34, shape: "rect", zone: "desno gore", combinable: true },
  { name: "G4", min_seats: 1, max_seats: 2, x: 661, y: 214, w: 34, h: 34, shape: "rect", zone: "desno gore", combinable: true },
  { name: "G5", min_seats: 1, max_seats: 2, x: 719, y: 214, w: 34, h: 34, shape: "rect", zone: "desno gore", combinable: true },
  { name: "G6", min_seats: 1, max_seats: 2, x: 777, y: 214, w: 34, h: 34, shape: "rect", zone: "desno gore", combinable: true },
  { name: "C1", min_seats: 1, max_seats: 2, x: 543, y: 235, w: 34, h: 34, shape: "rect", zone: "centar", combinable: true },
  { name: "C2", min_seats: 1, max_seats: 2, x: 610, y: 235, w: 34, h: 34, shape: "rect", zone: "centar", combinable: true },
  { name: "C3", min_seats: 1, max_seats: 2, x: 543, y: 295, w: 34, h: 34, shape: "rect", zone: "centar", combinable: true },
  { name: "C4", min_seats: 1, max_seats: 2, x: 610, y: 296, w: 34, h: 34, shape: "rect", zone: "centar", combinable: true },
  { name: "C5", min_seats: 1, max_seats: 2, x: 541, y: 371, w: 34, h: 34, shape: "rect", zone: "centar", combinable: true },
  { name: "C6", min_seats: 1, max_seats: 2, x: 608, y: 372, w: 34, h: 34, shape: "rect", zone: "centar", combinable: true },
  { name: "C7", min_seats: 1, max_seats: 2, x: 673, y: 371, w: 34, h: 34, shape: "rect", zone: "centar", combinable: true },
  { name: "C8", min_seats: 1, max_seats: 2, x: 541, y: 437, w: 34, h: 34, shape: "rect", zone: "centar", combinable: true },
  { name: "C9", min_seats: 1, max_seats: 2, x: 608, y: 439, w: 34, h: 34, shape: "rect", zone: "centar", combinable: true },
  { name: "O1", min_seats: 2, max_seats: 4, x: 432, y: 284, w: 56, h: 56, shape: "round", zone: "centar", combinable: false },
  { name: "O2", min_seats: 2, max_seats: 4, x: 666, y: 295, w: 56, h: 56, shape: "round", zone: "centar", combinable: false },
  { name: "O3", min_seats: 2, max_seats: 4, x: 420, y: 437, w: 56, h: 56, shape: "round", zone: "centar", combinable: false },
  { name: "O4", min_seats: 2, max_seats: 4, x: 657, y: 454, w: 56, h: 56, shape: "round", zone: "centar", combinable: false },
];
