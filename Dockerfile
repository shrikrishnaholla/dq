FROM node:5.11.1

COPY package.json /
RUN npm install

COPY . /dq
WORKDIR /dq

CMD ["node", "./bin/www"]
