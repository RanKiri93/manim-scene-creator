declare module 'spark-md5' {
  const SparkMD5: {
    ArrayBuffer: {
      hash(arr: ArrayBuffer, raw?: boolean): string;
    };
  };
  export default SparkMD5;
}
