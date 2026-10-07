/** Throwaway public keys (private halves deleted) with the fingerprints `ssh-keygen -lf` printed (OpenSSH 10.3). */
export const SSH_KEYS = {
  ed25519: {
    publicKey:
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL39WvZ8BxGPFfxS9Ujwl95OWQB4XQoibEBgUAcOlzKk fixture-ed25519',
    fingerprint: 'SHA256:a/5YOc32QgeV4x3vh+ezgFfO5ELa3Yku+Aaf0IFRzZM',
  },
  ecdsa256: {
    publicKey:
      'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBOTeiDYK9VdJ96xlvW8PIROUF94/SRjKNhJ/rbbxyl1cSgYKSwpG/5WNS8nole+xx0YUVWWLE4zFLROLmwzR9hU= fixture-ecdsa256',
    fingerprint: 'SHA256:8BdE3ptNGDsXq6LC40HNd0nyM7mnilMmlvEV/yLHHdU',
  },
  ecdsa384: {
    publicKey:
      'ecdsa-sha2-nistp384 AAAAE2VjZHNhLXNoYTItbmlzdHAzODQAAAAIbmlzdHAzODQAAABhBE385cUkyU2UKM2R4H724uDcs54Kxp3q5brDREoxLO4LiJhB8XdqymjeF7yAcUcDof1Oio2UcleyCEEkPpk1Bpeb2AZ/FV/1DhDv+vtkspNRz05333lSLFc3lc7dgBw5wg== fixture-ecdsa384',
    fingerprint: 'SHA256:jZdaXUmAFgUlLGfwXXbSqAuiN7iuY56A5w1yp8zsDDY',
  },
  ecdsa521: {
    publicKey:
      'ecdsa-sha2-nistp521 AAAAE2VjZHNhLXNoYTItbmlzdHA1MjEAAAAIbmlzdHA1MjEAAACFBAGZf+MdUBjSCgHD0CaQriTB4UXfyfqjG6y4fujH7ufcVbXMa/FO9/g2sPWBahHuxckZ2UkobNhch2JCJ4i8TxFPOQHAkm7PvWihW9GVlNq2T2hDXy93XKsLWsHV5shEV76F9cg5EgsZicg2oSXIRiFLHfUAukVdEDzxNlTbHbfFv7MDHg== fixture-ecdsa521',
    fingerprint: 'SHA256:GBq/JtKqF4seAt+FsYpHVVE5zZUEXLLnrHZGMUPk0eM',
  },
  rsa: {
    publicKey:
      'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDwefZf6tXJD+BaF8dw413+RhJjNcfAK0z6OlY8+h4Gu1aSgvNkyniEZhF4RMhuFhEFrkWeDDCBmJ7qb3JgbK2a43wqV10WizDtCPw0FrJR1FfH/oZEPC+0TeSgbX3C+j4DrC8ZGrSQnlKrkXyghKu4X/0h/czH0fLgW8jDAnBaqBbOI+10rcwP2dD/XscY/L1kRTsWJbuOqHvNOKVGHQ5kFpDuPuigL+Z7DfTpU+yeRWPNj03zm14m10mR509YD7OEWtRX1MRyZF4SeMYwOghlyGS5f38kRmqZkbesv+yTlFjoZztt/IUIsZGL73Mf0+kUXhCHAs72nAa41N1BnfiyhUygpRK74CeGZyoMvnwEJHNEOaAW6A71G280LleiaYML6ve/bG3p+U0l/F8UwWjCbOsqJZ/ywaKYNbVMzjZCk9UaFy1A7vx86hppEI0v4m8NcwwPYs1k8C+ZHuRZabO/tjhDdMTonyJhDtqziNncmX0eIRwF5TYsOUlB/+EBAzc= fixture-rsa',
    fingerprint: 'SHA256:XDa55FNQgMKOia9vp2C5mKhvyfxb15Z2VfAA1aGjMdE',
  },
  other: {
    publicKey:
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGsZIDlyl+AYbMChgzHiHrIffMlYiu74/nnwRsM355xE fixture-other',
    fingerprint: 'SHA256:JGwER10OiYBLbMxQfsFGUj2Mth/zDYpU8Z9uSuFkRHc',
  },
} as const;
